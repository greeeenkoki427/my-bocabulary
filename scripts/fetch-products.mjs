// 楽天商品検索APIから商品情報を取得し、data/products.json を作成します。
// 使い方:  RAKUTEN_APP_ID=xxxx node scripts/fetch-products.mjs
// 任意:    RAKUTEN_ACCESS_KEY (API側で必要になった場合)
//
// Amazon側は検索リンクのみ（PA-APIは審査後に利用可能になるため、後で差し替え）。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'config/products.json');
const outPath = resolve(root, 'data/products.json');

const APP_ID = process.env.RAKUTEN_APP_ID;
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';

if (!APP_ID) {
    console.error('RAKUTEN_APP_ID が設定されていません。環境変数に入れてから実行してください。');
    process.exit(1);
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
const affiliate = config.affiliate || {};

async function searchRakuten(keyword) {
    const params = new URLSearchParams({
        applicationId: APP_ID,
        keyword,
        hits: '1',
        sort: 'standard',
        imageFlag: '1',
        formatVersion: '2',
        format: 'json',
    });
    if (ACCESS_KEY) params.set('accessKey', ACCESS_KEY);
    if (affiliate.rakutenAffiliateId) params.set('affiliateId', affiliate.rakutenAffiliateId);

    const res = await fetch(`${ENDPOINT}?${params}`, { headers: { Referer: 'https://example.invalid/' } });
    if (!res.ok) throw new Error(`楽天API ${res.status}: ${keyword}`);
    const json = await res.json();
    const item = json.Items?.[0];
    if (!item) return null;
    return {
        name: item.itemName,
        price: item.itemPrice,
        image: item.mediumImageUrls?.[0] ?? null,
        rakutenUrl: item.affiliateUrl || item.itemUrl,
    };
}

function amazonSearchUrl(keyword) {
    const q = new URLSearchParams({ k: keyword });
    if (affiliate.amazonAssociateTag) q.set('tag', affiliate.amazonAssociateTag);
    return `https://www.amazon.co.jp/s?${q}`;
}

const output = {
    updatedAt: new Date().toISOString(),
    categories: [],
};

for (const cat of config.categories) {
    const items = [];
    for (const item of cat.items) {
        let product = null;
        try {
            product = await searchRakuten(item.keyword);
        } catch (e) {
            console.warn(e.message);
        }
        items.push({
            label: item.label,
            keyword: item.keyword,
            ...(product ?? { name: item.label, price: null, image: null, rakutenUrl: null }),
            amazonUrl: amazonSearchUrl(item.keyword),
        });
        console.log(`${cat.title} / ${item.label}: ${product ? '取得OK' : '該当なし・失敗'}`);
    }
    output.categories.push({ id: cat.id, title: cat.title, items });
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`書き出し: ${outPath}`);

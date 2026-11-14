#!/usr/bin/env node
// 楽天市場の商品検索APIで config/products.json の検索キーワードごとに1件ずつ商品を取り、
// data/products.json に書き出します。ページ側はこのファイルだけを読むので、表示は軽いままです。
//
// 使い方（アプリIDは環境変数で渡し、ファイルやチャットには書かないでください）:
//   RAKUTEN_APP_ID=xxxxx node scripts/fetch-products.mjs
//
// 任意の環境変数:
//   RAKUTEN_ACCESS_KEY  楽天側でアクセスキーが発行されている場合に指定
//   RAKUTEN_API_BASE    テスト用に検索APIの場所を差し替える（通常は指定不要）

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'config', 'products.json');
const OUT_PATH = join(ROOT, 'data', 'products.json');

const API_BASE = process.env.RAKUTEN_API_BASE
    || 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';
const APP_ID = process.env.RAKUTEN_APP_ID;
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY || '';
const DELAY_MS = 1100; // 楽天APIは1秒に1回程度までのため、余裕を持たせる
const THUMB = '_ex=200x200'; // 取得画像を小さめのサムネイルに差し替える

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function clip(s, n) {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// 画像URLのサイズ指定を小さいものに置き換える
function thumbOf(url) {
    if (!url) return undefined;
    return url.includes('_ex=') ? url.replace(/_ex=\d+x\d+/, THUMB) : url + (url.includes('?') ? '&' : '?') + THUMB;
}

// 応答は formatVersion=2（フラット）と従来形式（Item で包む）の両方に対応する
function firstItem(json) {
    const raw = Array.isArray(json?.Items) ? json.Items[0] : null;
    if (!raw) return null;
    return raw.Item ?? raw;
}

function imageOf(item) {
    const m = item.mediumImageUrls?.[0];
    return thumbOf(typeof m === 'string' ? m : m?.imageUrl);
}

// Amazonは検索ページへのリンク（アフィリエイトIDが設定されていれば付与）
function amazonUrl(keyword, tag) {
    const u = new URL('https://www.amazon.co.jp/s');
    u.searchParams.set('k', keyword);
    if (tag) u.searchParams.set('tag', tag);
    return u.toString();
}

async function searchOne(keyword) {
    const u = new URL(API_BASE);
    u.searchParams.set('applicationId', APP_ID);
    if (ACCESS_KEY) u.searchParams.set('accessKey', ACCESS_KEY);
    u.searchParams.set('keyword', keyword);
    u.searchParams.set('format', 'json');
    u.searchParams.set('formatVersion', '2');
    u.searchParams.set('sort', 'standard');
    u.searchParams.set('hits', '1');
    u.searchParams.set('imageFlag', '1');
    u.searchParams.set('availability', '1');

    const res = await fetch(u, { headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) {
        const msg = json?.error_description || json?.error || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return firstItem(json);
}

async function main() {
    if (!APP_ID) {
        console.error('RAKUTEN_APP_ID が設定されていません。環境変数に楽天のアプリIDを入れてから実行してください。');
        process.exit(1);
    }

    const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    const tag = config.affiliate?.amazonAssociateTag || '';
    const out = { updatedAt: new Date().toISOString(), categories: [] };
    let ok = 0, failed = 0;

    for (const cat of config.categories) {
        const items = [];
        for (const def of cat.items) {
            try {
                const hit = await searchOne(def.keyword);
                if (!hit) throw new Error('該当する商品がありません');
                items.push({
                    label: def.label,
                    name: clip(hit.itemName, 60),
                    price: typeof hit.itemPrice === 'number' ? hit.itemPrice : Number(hit.itemPrice) || undefined,
                    image: imageOf(hit),
                    rakutenUrl: hit.itemUrl,
                    amazonUrl: amazonUrl(def.keyword, tag),
                });
                ok++;
                console.log(`✓ ${cat.id} / ${def.label}`);
            } catch (e) {
                failed++;
                console.warn(`✗ ${cat.id} / ${def.label}: ${e.message}`);
            }
            await sleep(DELAY_MS);
        }
        out.categories.push({ id: cat.id, items });
    }

    if (ok === 0) {
        console.error('1件も取得できませんでした。アプリIDと接続を確認してください。既存の data/products.json は変更していません。');
        process.exit(1);
    }

    // 途中で壊れたファイルを残さないよう、一時ファイルに書いてから置き換える
    await mkdir(dirname(OUT_PATH), { recursive: true });
    const tmp = OUT_PATH + '.tmp';
    await writeFile(tmp, JSON.stringify(out, null, 2) + '\n', 'utf8');
    await rename(tmp, OUT_PATH);
    console.log(`\n完了: 取得 ${ok} 件 / 失敗 ${failed} 件 → data/products.json`);
}

main().catch(e => {
    console.error('予期しないエラー:', e.message);
    process.exit(1);
});

import { type OnAssetsConversionHandler, AssetConversion } from '@metamask/snaps-sdk';
import type { CaipAssetType } from '@metamask/keyring-api';

const COINGECKO_IDS: Record<string, string> = {
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501': 'solana',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'usd-coin', // USDC
  'swift:0/iso4217:USD': 'usd',
};

export const onAssetsConversion: OnAssetsConversionHandler = async (params) => {
  console.log("🧾 onAssetsConversion params:", JSON.stringify(params, null, 2));

  const { conversions } = params;

  const conversionRates: Record<
    CaipAssetType,
    Record<CaipAssetType, AssetConversion | null>
  > = {};

  for (const { from, to } of conversions) {
    const fromKey = from;
    const toKey = to;

    if (!conversionRates[fromKey]) {
      conversionRates[fromKey] = {};
    }

    const fromId = COINGECKO_IDS[fromKey];
    const toId = COINGECKO_IDS[toKey];

    if (!fromId || !toId) {
      console.warn(`⚠️ Unsupported conversion from ${fromKey} to ${toKey}`);
      conversionRates[fromKey][toKey] = null;
      continue;
    }

    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${fromId}&vs_currencies=${toId}`;
      console.log(`🌐 Fetching conversion rate from: ${url}`);

      const response = await fetch(url);
      const json = await response.json();

      const rate = json?.[fromId]?.[toId];

      if (typeof rate !== 'number') {
        throw new Error(`❌ Invalid or missing rate for ${fromId} -> ${toId}`);
      }

      const now = Date.now();

      conversionRates[fromKey][toKey] = {
        rate: rate.toString(), // MetaMask expects string
        conversionTime: now,
        expirationTime: now + 60_000, // 1 minute TTL
      };

      console.log(`✅ Rate for ${fromKey} → ${toKey}: ${rate}`);
    } catch (err) {
      console.error(`❌ Failed to fetch rate for ${fromKey} → ${toKey}:`, err);
      conversionRates[fromKey][toKey] = null;
    }
  }

  console.log("📦 Final conversionRates:", JSON.stringify(conversionRates, null, 2));

  return {
    conversionRates,
  };
};
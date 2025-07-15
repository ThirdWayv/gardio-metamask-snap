
import {
  SolScope,
  Balance,
  CaipAssetTypeStruct,
  type Transaction,
} from '@metamask/keyring-api';
import type { CaipAssetType } from '@metamask/snaps-sdk';

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
    Connection,
    PublicKey,
    LAMPORTS_PER_SOL,
    SignaturesForAddressOptions,
    ConfirmedSignatureInfo,
    ParsedTransactionWithMeta,
    ParsedInstruction,
} from '@solana/web3.js';
import type { Signature } from '@solana/kit';
import bs58 from 'bs58';

const RPC_URL = 'https://floral-snowy-asphalt.solana-mainnet.quiknode.pro/3e073b0bc4a43256ee2254f4ec81eed0f2a66a03/';

enum KnownCaip19Id {
  SolMainnet = `${SolScope.Mainnet}/slip44:501`,
  SolDevnet = `${SolScope.Devnet}/slip44:501`,
  SolTestnet = `${SolScope.Testnet}/slip44:501`,
  UsdcMainnet = `${SolScope.Mainnet}/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
  UsdcDevnet = `${SolScope.Devnet}/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`,
  EurcMainnet = `${SolScope.Mainnet}/token:HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr`,
  EurcDevnet = `${SolScope.Devnet}/token:HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr`,
}

export async function getAccountBalances(
    accountAddress: string,
    assets: CaipAssetType[]
): Promise<Record<CaipAssetType, Balance>> {

    const result: Record<CaipAssetType, Balance> = {};
    const pubkey = new PublicKey(accountAddress);
    const connection = new Connection(RPC_URL, 'confirmed');

    for (const caip19 of assets) {

    const parts = caip19.split('/');
    if (parts.length !== 2) continue;

    const [chainId, assetId] = parts;
    if (chainId !== SolScope.Mainnet) continue;

    const assetParts = assetId.split(':');
    if (assetParts.length !== 2) continue;

    const type = assetParts[0];
    const ref = assetParts[1];
    if (!type || !ref) continue;

    if (type === 'slip44' && ref === '501') {
        const lamports = await connection.getBalance(pubkey);
        result[caip19] = {
        amount: (lamports / 1e9).toFixed(9),
        unit: 'SOL',
        };
    }

    if (type === 'token') {
        const mint = new PublicKey(ref);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { mint });
        const tokenAccount = tokenAccounts.value[0];

        const amount = tokenAccount
        ? tokenAccount.account.data.parsed.info.tokenAmount.uiAmountString
        : '0';

        result[caip19] = {
        amount,
        unit: lookupSymbol(ref),
        };
    }
    }

    return result;
}


export async function listAccountAssets(accountAddress: string): Promise<CaipAssetType[]> {
    try {
    
        const assets: CaipAssetType[] = [];
        const connection = new Connection(RPC_URL, 'confirmed');
        const publicKey = new PublicKey(accountAddress);

        // Native SOL
        const lamports = await connection.getBalance(publicKey);
        if (lamports > 0) {
            const nativeAsset = `${SolScope.Mainnet}/slip44:501` as CaipAssetType;
            CaipAssetTypeStruct.assert(nativeAsset);
            assets.push(nativeAsset);
        }

        // SPL Tokens
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: TOKEN_PROGRAM_ID,
        });

        for (const { account } of tokenAccounts.value) {
            const info = (account.data as any).parsed.info;
            const mint = info.mint;
            const uiAmount = info.tokenAmount.uiAmount;

            if (uiAmount && uiAmount > 0) {
            const tokenAsset = `${SolScope.Mainnet}/token:${mint}` as CaipAssetType;
            try {
                CaipAssetTypeStruct.assert(tokenAsset);
                assets.push(tokenAsset);
            } catch (e) {
                console.warn(`Invalid CAIP format for token: ${tokenAsset}`);
            }
            }
        }
    
        return assets;
    } catch (error: any) {
        throw error;
    }
}


/**
 * Bootstrap the transactions for the given account.
 * @param accountAddress - The id of the account.
 * @param pagination - The pagination options.
 * @param pagination.limit - The limit of the transactions to fetch.
 * @param pagination.next - The next signature to fetch from.
 * @returns The transactions for the given account.
 */
export async function listAccountTransactions(
    accountAddress: string,
    pagination: { limit: number; next?: Signature | null },
    accountId: string
): Promise<{
    data: Transaction[];
    next: Signature | null;
}> {

    if (!isValidSolanaAddress(accountAddress)) {
        throw new Error('Invalid Solana address');
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const pubkey = new PublicKey(accountAddress);
    const options: SignaturesForAddressOptions = { limit: pagination.limit };

    const signatures: ConfirmedSignatureInfo[] = await connection.getSignaturesForAddress(pubkey, options);
    if (!signatures.length)   
        return {
            data: [],
            next: null,
        };

    const parsedTxs: (ParsedTransactionWithMeta | null)[] = await connection.getParsedTransactions(
    signatures.map((sig) => sig.signature),
    { maxSupportedTransactionVersion: 0 },
    );

    const txs: Transaction[] = parsedTxs
    .map((tx, i) => {
        const sigInfo = signatures[i];
        if (!tx || !sigInfo) return null;

        const signature = sigInfo.signature;
        const blockTime = tx.blockTime ?? null;
        const fee = tx.meta?.fee ?? 0;
        const status: Transaction['status'] = tx.meta?.err ? 'failed' : 'confirmed';

        const message = tx.transaction.message;

        // Default: unknown tx
        let type: Transaction['type'] = 'unknown';

        const from: Transaction['from'] = [];
        const to: Transaction['to'] = [];

        for (const ix of message.instructions as ParsedInstruction[]) {
            if (
                ix.program === 'system' &&
                ix.parsed?.type === 'transfer' &&
                ix.parsed.info.source &&
                ix.parsed.info.destination &&
                ix.parsed.info.lamports
            ) {
                type = ix.parsed.info.source === accountAddress ? 'send' : 'receive';

                const lamports = ix.parsed.info.lamports;
                const sol = (Number(lamports) / LAMPORTS_PER_SOL).toString();

                from.push({
                address: ix.parsed.info.source,
                asset: {
                    unit: 'SOL',
                    type: KnownCaip19Id.SolMainnet,
                    amount: sol,
                    fungible: true,
                },
                });

                to.push({
                address: ix.parsed.info.destination,
                asset: {
                    unit: 'SOL',
                    type: KnownCaip19Id.SolMainnet,
                    amount: sol,
                    fungible: true,
                },
                });
            }
        }

        const transaction: Transaction = {
            id: signature,
            account: accountId,
            chain: SolScope.Mainnet,
            type,
            status,
            timestamp: blockTime,

            from,
            to,

            fees: [
                {
                type: 'base',
                asset: {
                    unit: 'SOL',
                    type: KnownCaip19Id.SolMainnet,
                    amount: (fee / LAMPORTS_PER_SOL).toString(),
                    fungible: true,
                },
                },
            ],

            events: [
                {
                status,
                timestamp: blockTime,
                },
            ],
        };

        return transaction;
    })
    .filter((tx): tx is Transaction => tx !== null);

    return {
        data: txs,
        next: pagination.next ? pagination.next: null,
    };
}

function isValidSolanaAddress(address: string): boolean {
    try {
        const decoded = bs58.decode(address);
        return decoded.length === 32;
    } catch {
        return false;
    }
}

// Symbol lookup for tokens
function lookupSymbol(mint: string): string {
    const map: Record<string, string> = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
    'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr': 'EURC',
    'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC': 'AI16Z',
    };
    return map[mint] ?? 'TOKEN';
}
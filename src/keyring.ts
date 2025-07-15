import type {
  SubmitRequestResponse,
  KeyringEventPayload
} from "@metamask/keyring-api";

import {
  KeyringEvent,
  SolAccountType,
  SolMethod,
  EthScope,
  SolScope,
  Balance,
  type Keyring,
  type KeyringAccount,
  type KeyringRequest,
  type Transaction,
} from '@metamask/keyring-api';

import {
  EthAccountType,
  EthMethod,
} from "@metamask/keyring-api";
import { emitSnapKeyringEvent } from '@metamask/keyring-snap-sdk';
import { type Json } from "@metamask/utils";
import { v4 } from "uuid";

import { saveState } from "./stateManagement";
import { isEvmChain, isUniqueAddress, throwError } from "./util";

import type { CaipAssetType } from '@metamask/snaps-sdk';

import { Connection, PublicKey, LAMPORTS_PER_SOL, SignaturesForAddressOptions } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CaipAssetTypeStruct } from '@metamask/keyring-api'; // or your path

import bs58 from 'bs58';


const RPC_URL = 'https://floral-snowy-asphalt.solana-mainnet.quiknode.pro/3e073b0bc4a43256ee2254f4ec81eed0f2a66a03/';

import {
  ConfirmedSignatureInfo,
  ParsedTransactionWithMeta,
  ParsedInstruction,
} from '@solana/web3.js';


enum KnownCaip19Id {
  SolMainnet = `${SolScope.Mainnet}/slip44:501`,
  SolDevnet = `${SolScope.Devnet}/slip44:501`,
  SolTestnet = `${SolScope.Testnet}/slip44:501`,
  UsdcMainnet = `${SolScope.Mainnet}/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
  UsdcDevnet = `${SolScope.Devnet}/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`,
  EurcMainnet = `${SolScope.Mainnet}/token:HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr`,
  EurcDevnet = `${SolScope.Devnet}/token:HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr`,
}

type SolanaAccountInfo = {
  txs: Transaction[], 
  assets: CaipAssetType[], 
  balance: Record<CaipAssetType, Balance>
};


export type KeyringState = {
  wallets: Record<string, Wallet>;
  pendingRequests: Record<string, KeyringRequest>;
  useSyncApprovals: boolean;
  solanaAccountInfo: SolanaAccountInfo;
};

export type Wallet = {
  account: KeyringAccount;
  pendingCreation: boolean;
};

const enumCoinType = {
  ETHEREUM: 23,
  SOLANA: 57,
  CRYPTO_GUARD_IF_COIN_INVALID: -1
};

type Signature = string;

export class SimpleKeyring implements Keyring {
  readonly #state: KeyringState;

  constructor(state: KeyringState) {
    this.#state = state;
       // Ensure solanaAccountInfo is initialized
    if (!state.solanaAccountInfo) {
      state.solanaAccountInfo = {
        txs: [],
        assets: [],
        balance: {},
      };
    }
  }

  async listAccounts(): Promise<KeyringAccount[]> {
    return Object.values(this.#state.wallets).map((wallet) => wallet.account);
  }

  async getAccount(id: string): Promise<KeyringAccount> {
    return (
      this.#state.wallets[id]?.account ??
      throwError(`Account '${id}' not found`)
    );
  }

  async createAccount(
    options: Record<string, Json> = {}
  ): Promise<KeyringAccount> {

    const id = globalThis.crypto.randomUUID();
    try {
      if(options && options.address && options.name)
      {
        const address: string = options.address as string;
        let account: KeyringAccount;

        if (!isUniqueAddress(address, Object.values(this.#state.wallets))) {
          throw new Error(`Account address already in use: ${address}`);
        }
        
        switch(options.networkType)
        {
          case enumCoinType.ETHEREUM:
            {
              account = {
                id: v4(), // Call `v4()` from `uuid`
                options: {},
                address,
                scopes: [EthScope.Eoa, EthScope.Mainnet, EthScope.Testnet],
                methods: [
                  EthMethod.PersonalSign,
                  EthMethod.Sign,
                  EthMethod.SignTransaction,
                  EthMethod.SignTypedDataV1,
                  EthMethod.SignTypedDataV3,
                  EthMethod.SignTypedDataV4,
                ],
                type: EthAccountType.Eoa,
              };
              break;
            }
          case enumCoinType.SOLANA:
            {
              account = {
                id, 
                options: {},
                address,
                scopes: [SolScope.Mainnet, SolScope.Testnet, SolScope.Devnet],
                methods: [
                  SolMethod.SignAndSendTransaction,
                  SolMethod.SignTransaction,
                  SolMethod.SignMessage,
                  SolMethod.SignIn,
                ],
                type: SolAccountType.DataAccount,
              };

              break;
            }

            default:
              throw new Error("Invalid options.networkType" + options.networkType);
        } 
        

        this.#state.wallets[account.id] = {
          account: account,
          pendingCreation: true,
        };

        await this.#emitEvent(KeyringEvent.AccountCreated, {
          account,
          accountNameSuggestion: options.name as string,
        });

        // Save account options in snap only
        // No need to import it in metamask
        account.options = options;

        this.#state.wallets[account.id] = {
          account: account,
          pendingCreation: false,
        };

        // await this.#saveState();

        return account;
      }
      else
      {
        throw new Error("Invalid Arguments");
      }
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async filterAccountChains(_id: string, chains: string[]): Promise<string[]> {
    // The `id` argument is not used because all accounts created by this snap
    // are expected to be compatible with any EVM chain.
    return chains.filter((chain) => isEvmChain(chain));
  }

  async updateAccount(account: KeyringAccount): Promise<void> {
    const wallet =
      this.#state.wallets[account.id] ??
      throwError(`Account '${account.id}' not found`);

    const newAccount: KeyringAccount = {
      ...wallet.account,
      ...account,
      // Restore read-only properties.
      address: wallet.account.address,
    };

    try {
      await this.#emitEvent(KeyringEvent.AccountUpdated, {
        account: newAccount,
      });
      wallet.account = newAccount;
      await this.#saveState();
    } catch (error) {
      throwError((error as Error).message);
    }
  }

  async deleteAccount(id: string): Promise<void> {
    try {
      await this.#emitEvent(KeyringEvent.AccountDeleted, { id });
      delete this.#state.wallets[id];
      await this.#saveState();
    } catch (error) {
      throwError((error as Error).message);
    }
  }

  async listRequests(): Promise<KeyringRequest[]> {
    return Object.values(this.#state.pendingRequests);
  }

  async getRequest(id: string): Promise<KeyringRequest> {
    return (
      this.#state.pendingRequests[id] ?? throwError(`Request '${id}' not found`)
    );
  }

  async submitRequest(request: KeyringRequest): Promise<SubmitRequestResponse> {
    return this.#asyncSubmitRequest(request);
  }

  async approveRequest(
    id: string,
    data?: Record<string, Json>
  ): Promise<void> {

    const { request } =
      this.#state.pendingRequests[id] ??
      throwError(`Request '${id}' not found`);

    let result: string | Record<string, Json> | [] = [];

    if(data !== undefined)
    {
      switch(request.method as EthMethod)
      {
        case EthMethod.PersonalSign:
        case EthMethod.Sign:
        case EthMethod.SignTypedDataV1:
        case EthMethod.SignTypedDataV3:
        case EthMethod.SignTypedDataV4:
        case EthMethod.SignUserOperation:
          {
            if(data.data !== undefined && (typeof data.data === "string"))
            {
              result = data.data;
            }
            else
            {
              throwError(`Invalid Data ${JSON.stringify(data)}`);
            }
            break;
          }
        case EthMethod.SignTransaction:
        case EthMethod.PrepareUserOperation:
        case EthMethod.PatchUserOperation:
          {
            if(typeof data === "object")
            {
              result = data;
            }
            else
            {
              throwError(`Invalid Data ${JSON.stringify(data)}`);
            }
            break;
          }

        default:
          throwError(`EVM method '${request.method}' not supported`);
      }
    }
    else
    {
      throwError(`Invalid Data ${data}`);
    }

    try {
      await this.#removePendingRequest(id);
      await this.#emitEvent(KeyringEvent.RequestApproved, { id, result });
    } catch (error) {
      throwError((error as Error).message);
    }
  }

  async rejectRequest(id: string): Promise<void> {
    if (this.#state.pendingRequests[id] === undefined) {
      throw new Error(`Request '${id}' not found`);
    }

    await this.#removePendingRequest(id);
    await this.#emitEvent(KeyringEvent.RequestRejected, { id });
  }




  #isValidSolanaAddress(address: string): boolean {
    try {
      const decoded = bs58.decode(address);
      return decoded.length === 32;
    } catch {
      return false;
    }
  }


/**
 * Fetches the latest parsed transactions for a given Solana address.
 *
 * @param address - The base58-encoded Solana address.
 * @param limit - Number of transactions to fetch (default: 10).
 * @param before - Optional signature to paginate before.
 * @param rpcUrl - The Solana RPC endpoint to use.
 * @returns An array of parsed transactions.
 */
async fetchLatestAddressTransactions(
  address: string,
  limit = 10,
  before: string | null,
  rpcUrl: string,
  accountId: string, // UUIDv4
): Promise<Transaction[]> {
  if (!this.#isValidSolanaAddress(address)) {
    throw new Error('Invalid Solana address');
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const pubkey = new PublicKey(address);
  const options: { limit: number; before?: string } = { limit };
  if (before) options.before = before;

  const signatures: ConfirmedSignatureInfo[] = await connection.getSignaturesForAddress(pubkey, options);
  if (!signatures.length) return [];

  const parsedTxs: (ParsedTransactionWithMeta | null)[] = await connection.getParsedTransactions(
    signatures.map((sig) => sig.signature),
    { maxSupportedTransactionVersion: 0 },
  );

  const chainId = SolScope.Mainnet; // or devnet, testnet, etc.

  const txs: Transaction[] = parsedTxs
    .map((tx, i) => {
      const sigInfo = signatures[i];
      if (!tx || !sigInfo) return null;

      const signature = sigInfo.signature;
      const blockTime = tx.blockTime ?? null;
      const fee = tx.meta?.fee ?? 0;
      const status: Transaction['status'] = tx.meta?.err ? 'failed' : 'confirmed';

      const message = tx.transaction.message;
      const feePayer = message.accountKeys[0]?.pubkey?.toBase58?.() || address;

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
          type = ix.parsed.info.source === address ? 'send' : 'receive';

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
        account: '255386e4-a327-46c6-9171-ff1d195ae18f',
        chain: chainId,
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

  return txs;
}

  /**
   * Bootstrap the transactions for the given account.
   * @param accountId - The id of the account.
   * @param pagination - The pagination options.
   * @param pagination.limit - The limit of the transactions to fetch.
   * @param pagination.next - The next signature to fetch from.
   * @returns The transactions for the given account.
   */
  async listAccountTransactions(
    accountId: string,
    pagination: { limit: number; next?: Signature | null },
  ): Promise<{
    data: Transaction[];
    next: Signature | null;
  }> {
    const wallet = this.#state.wallets[accountId];
    
    if(wallet?.account == undefined){
      throw new Error(`Account '${accountId}' not found`);
    }

    if (!this.#isValidSolanaAddress(wallet.account.address)) {
      throw new Error('Invalid Solana address');
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const pubkey = new PublicKey(wallet.account.address);
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
            type = ix.parsed.info.source === wallet.account.address ? 'send' : 'receive';

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
      next: null,
    };
  }


  // Symbol lookup for tokens
  #lookupSymbol(mint: string): string {
    const map: Record<string, string> = {
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr': 'EURC',
      'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC': 'AI16Z',
    };
    return map[mint] ?? 'TOKEN';
  }

  async getAccountBalances(
    accountId: string,
    assets: CaipAssetType[]
  ): Promise<Record<CaipAssetType, Balance>> {

    const wallet = this.#state.wallets[accountId];
      
    if(wallet?.account == undefined){
      throw new Error(`Account '${accountId}' not found`);
    }

    const result: Record<CaipAssetType, Balance> = {};
    const pubkey = new PublicKey(wallet.account.address);
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
          unit: this.#lookupSymbol(ref),
        };
      }
    }

    return result;
  }


  async listAccountAssets(accountId: string): Promise<CaipAssetType[]> {
    try {
      
      const wallet = this.#state.wallets[accountId];
      const assets: CaipAssetType[] = [];

      if(wallet?.account == undefined){
        throw new Error(`Account '${accountId}' not found`);
      }

      const connection = new Connection(RPC_URL, 'confirmed');
      const publicKey = new PublicKey(wallet?.account.address);

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

  async IsPendingCreation(): Promise<boolean> {
    return Object.values(this.#state.wallets).some((wallet) => wallet.pendingCreation);
  } 

  async #removePendingRequest(id: string): Promise<void> {
    delete this.#state.pendingRequests[id];
    await this.#saveState();
  }

  #getCurrentUrl(): string {
    const dappUrlPrefix =
      process.env.NODE_ENV === "production"
        ? process.env.DAPP_ORIGIN_PRODUCTION
        : process.env.DAPP_ORIGIN_DEVELOPMENT;

    return dappUrlPrefix as string;
  }

  async #asyncSubmitRequest(
    request: KeyringRequest
  ): Promise<SubmitRequestResponse> {

    this.#state.pendingRequests[request.id] = request;
    await this.#saveState();
    const dappUrl = this.#getCurrentUrl();
    return {
      pending: true,
      redirect: {
        url: dappUrl,
        message: "Redirecting to Gardio Snap to sign transaction",
      },
    };
  }

  async #saveState(): Promise<void> {
    await saveState(this.#state);
  }

  async #emitEvent(
    event: KeyringEvent,
    data: KeyringEventPayload<KeyringEvent>,
  ): Promise<void> {
    await emitSnapKeyringEvent(snap, event, data);
  }
}

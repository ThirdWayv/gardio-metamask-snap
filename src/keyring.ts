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
  type Pagination,
  type Paginated,
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

import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { clusterApiUrl } from "@solana/web3.js";
import { CaipAssetTypeStruct } from '@metamask/keyring-api'; // or your path


const RPC_URL = 'https://floral-snowy-asphalt.solana-mainnet.quiknode.pro/3e073b0bc4a43256ee2254f4ec81eed0f2a66a03/';

const CHAIN_ID = 'solana:mainnet-beta';

import {
  ConfirmedSignatureInfo,
  ParsedTransactionWithMeta,
  ParsedInstruction,
  PartiallyDecodedInstruction,
} from '@solana/web3.js';



type ListAccountTransactionsResponse = {
  data: Transaction[];
  next: string | null;
};

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

  async getAccountAssets(accountAddress: string, rpcUrl: string): Promise<CaipAssetType[]> {
  const CHAIN_ID = 'solana:mainnet-beta';
  const assets: CaipAssetType[] = [];

  const connection = new Connection(rpcUrl, 'confirmed');
  const publicKey = new PublicKey(accountAddress);

  // 1️⃣ Native SOL
  const lamports = await connection.getBalance(publicKey);
  if (lamports > 0) {
    const nativeAsset = `${CHAIN_ID}/native:SOL` as CaipAssetType;
    CaipAssetTypeStruct.assert(nativeAsset);
    assets.push(nativeAsset);
  }

  // 2️⃣ SPL Tokens
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
    programId: TOKEN_PROGRAM_ID,
  });

  for (const { account } of tokenAccounts.value) {
    const info = (account.data as any).parsed.info;
    const mint = info.mint;
    const uiAmount = info.tokenAmount.uiAmount;

    if (uiAmount && uiAmount > 0) {
      const tokenAsset = `${CHAIN_ID}/token:${mint}` as CaipAssetType;
      try {
        CaipAssetTypeStruct.assert(tokenAsset);
        assets.push(tokenAsset);
      } catch (e) {
        console.warn(`Invalid CAIP format for token: ${tokenAsset}`);
      }
    }
  }
  
  console.error("assets", assets);

  return assets;
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
  console.log(" listAccountTransactions accountId: ", accountId, "pagination: ", pagination);
  console.log(" this.#state.solanaAccountInfo.txs", this.#state.solanaAccountInfo.txs);
  
  this.#state.solanaAccountInfo.txs.forEach((tx) => {
    tx.account = accountId;
  });
  
  console.log(" txs account", this.#state.solanaAccountInfo.txs[0]?.account);

  return {
    data: this.#state.solanaAccountInfo.txs,
    next: null,
  };
}
 
 convertToScopedCaip(assetId: string): CaipAssetType {
  const [chainPart, assetPart] = assetId.split('/'); // 'solana:mainnet' & 'slip44:501'
  if (!chainPart || !assetPart) return assetId as CaipAssetType;

  const [namespace, network] = chainPart.split(':');
  if (namespace !== 'solana') return assetId as CaipAssetType;

  let scoped: string | undefined;

  switch (network) {
    case 'mainnet':
    case 'mainnet-beta':
      scoped = SolScope.Mainnet;
      break;
    case 'devnet':
      scoped = SolScope.Devnet;
      break;
    case 'testnet':
      scoped = SolScope.Testnet;
      break;
    default:
      return assetId as CaipAssetType;
  }

  return `${scoped}/${assetPart}` as CaipAssetType;
}

convertToSymbolicCaip(assetId: CaipAssetType): CaipAssetType {
  const [chainPart, assetPart] = assetId.split('/');
  const [namespace, cluster] = chainPart.split(':');

  if (namespace !== 'solana') return assetId;

  let symbolic = '';

  switch (cluster) {
    case SolScope.Mainnet.split(':')[1]:
      symbolic = 'mainnet';
      break;
    case SolScope.Devnet.split(':')[1]:
      symbolic = 'devnet';
      break;
    case SolScope.Testnet.split(':')[1]:
      symbolic = 'testnet';
      break;
    default:
      return assetId;
  }

  return `solana:${symbolic}/${assetPart}` as CaipAssetType;
}

async getAccountBalances(
  id: string,
  assets: CaipAssetType[]
): Promise<Record<CaipAssetType, Balance>> {
  const result: Record<CaipAssetType, Balance> = {};
  const storedBalances = this.#state.solanaAccountInfo?.balance ?? {};

  for (const assetId of assets) {
    const symbolicAssetId = this.convertToSymbolicCaip(assetId);
    const balance = storedBalances[symbolicAssetId];

    result[assetId] = balance ?? {
      amount: '0',
      unit: 'UNKNOWN',
    };
  }
  console.log("getAccountBalances", result);
  return result;
}


async listAccountAssets(accountId: string): Promise<CaipAssetType[]> {
  try {
    const assets = this.#state.solanaAccountInfo?.assets ?? [];

    // Normalize each CAIP asset string to scoped version
    const mapped = assets.map(this.convertToScopedCaip);

    console.log("listAccountAssets mapped:", mapped);
    return mapped;

  } catch (error: any) {
    console.error("listAccountAssets error:", error);
    throw error;
  }
}


  /**
   * Returns the list of assets for the given account in all Solana networks.
   * @param accountId - The id of the account.
   * @returns CAIP-19 assets ids.
   */
  async setTransactions(params: {
        Transactions: Transaction[];
        Assets: CaipAssetType[];
        Balance: Record<CaipAssetType, Balance>;
      }) {
    try {
      console.error("setTransactions params", params);
          this.#state.solanaAccountInfo.txs = params.Transactions;
          this.#state.solanaAccountInfo.assets = params.Assets;
          this.#state.solanaAccountInfo.balance = params.Balance;

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

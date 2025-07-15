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
import type { Signature } from '@solana/kit';
import { listAccountAssets, listAccountTransactions, getAccountBalances } from './web3/solana';

export type KeyringState = {
  wallets: Record<string, Wallet>;
  pendingRequests: Record<string, KeyringRequest>;
  useSyncApprovals: boolean;
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

export class SimpleKeyring implements Keyring {
  readonly #state: KeyringState;

  constructor(state: KeyringState) {
    this.#state   = state;
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

  async listAccountTransactions(
    accountId: string,
    pagination: { limit: number; next?: Signature | null },
  ): Promise<{
    data: Transaction[];
    next: Signature | null;
  }> {
    try{
      
      const wallet = this.#state.wallets[accountId];

      if(wallet?.account == undefined){
        throw new Error(`Account '${accountId}' not found`);
      }
      
      const result = await listAccountTransactions(wallet.account.address, pagination, accountId);

      return result;
    }
    catch(error)
    {
      throwError((error as Error).message);
    }
  }

  async getAccountBalances(
    accountId: string,
    assets: CaipAssetType[]
  ): Promise<Record<CaipAssetType, Balance>> {
    try{
      const wallet = this.#state.wallets[accountId];
        
      if(wallet?.account == undefined){
        throw new Error(`Account '${accountId}' not found`);
      }

      const result = await getAccountBalances(wallet.account.address, assets);

      return result;
    }
    catch(error)
    {
      throwError((error as Error).message);
    }
  }

  async listAccountAssets(accountId: string): Promise<CaipAssetType[]> {
    try {
      
      const wallet = this.#state.wallets[accountId];
    
      if(wallet?.account == undefined){
        throw new Error(`Account '${accountId}' not found`);
      }

      const result = await listAccountAssets(wallet.account.address);
      
      return result;
    } catch (error) {
      throwError((error as Error).message);
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

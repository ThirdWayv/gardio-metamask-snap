import type {
  Keyring,
  KeyringAccount,
  KeyringRequest,
  SubmitRequestResponse,
} from "@metamask/keyring-api";
import {
  EthAccountType,
  EthMethod,
  emitSnapKeyringEvent,
} from "@metamask/keyring-api";
import { KeyringEvent } from "@metamask/keyring-api/dist/events";
import { type Json } from "@metamask/utils";
import { v4 } from "uuid";

import { saveState } from "./stateManagement";
import { isEvmChain, isUniqueAddress, throwError } from "./util";


export type KeyringState = {
  wallets: Record<string, Wallet>;
  pendingRequests: Record<string, KeyringRequest>;
  useSyncApprovals: boolean;
};

export type Wallet = {
  account: KeyringAccount;
  hdPath: string;
  pendingCreation: boolean;
};

export class SimpleKeyring implements Keyring {
  readonly #state: KeyringState;

  constructor(state: KeyringState) {
    this.#state = state;
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

    try {
      const address: string = options.address as string;

      if (!isUniqueAddress(address, Object.values(this.#state.wallets))) {
        throw new Error(`Account address already in use: ${address}`);
      }
      
      const account: KeyringAccount = {
        id: v4(), // Call `v4()` from `uuid`
        options,
        address,
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
      
      this.#state.wallets[account.id] = {
        account: account,
        hdPath: options.hdPath as string,
        pendingCreation: true,
      };

      const accountIdx = this.#state.wallets
      ? Object.keys(this.#state.wallets).length
      : 0;

      await this.#emitEvent(KeyringEvent.AccountCreated, {
        account,
        accountNameSuggestion: "Gardio Account " + accountIdx,
      });

      console.error("AccountCreated");
      this.#state.wallets[account.id] = {
        account: account,
        hdPath: options.hdPath as string,
        pendingCreation: false,
      };

      await this.#saveState();

      return account;
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
    data: Record<string, Json>
  ): Promise<void> {
    await emitSnapKeyringEvent(snap, event, data);
  }
}

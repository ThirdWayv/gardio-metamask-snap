import { KeyringRpcMethod } from '@metamask/keyring-api';
import { onRpcRequest } from '.';

export enum InternalMethod {
  IsPendingCreation   = 'snap.internal.isPendingCreation',
}

export enum RpcRequestMethod {
  StartSendTransactionFlow = 'startSendTransactionFlow',
  GetFeeForTransaction = 'getFeeForTransaction',
}


export const originPermissions = new Map<string, string[]>([
  [
    'metamask',
    [
      // Keyring methods
      KeyringRpcMethod.ListAccounts,
      KeyringRpcMethod.GetAccount,
      KeyringRpcMethod.DeleteAccount,
      KeyringRpcMethod.ListRequests,
      KeyringRpcMethod.GetRequest,
      KeyringRpcMethod.SubmitRequest,
      KeyringRpcMethod.RejectRequest,
      KeyringRpcMethod.ListAccountAssets,
      KeyringRpcMethod.ListAccountTransactions,
      KeyringRpcMethod.GetAccountBalances,
      // RPC methods
      RpcRequestMethod.StartSendTransactionFlow,
    ],
  ],
  [
    'http://localhost:8000',
    [
      // Keyring methods
      KeyringRpcMethod.ListAccounts,
      KeyringRpcMethod.GetAccount,
      KeyringRpcMethod.CreateAccount,
      KeyringRpcMethod.UpdateAccount,
      KeyringRpcMethod.DeleteAccount,
      KeyringRpcMethod.ListRequests,
      KeyringRpcMethod.GetRequest,
      KeyringRpcMethod.ApproveRequest,
      KeyringRpcMethod.RejectRequest,
      // Custom methods
      InternalMethod.IsPendingCreation,
    ],
  ],
  [
    'https://gardiometamasksnap.web.app',
    [
      // Keyring methods
      KeyringRpcMethod.ListAccounts,
      KeyringRpcMethod.GetAccount,
      KeyringRpcMethod.CreateAccount,
      KeyringRpcMethod.UpdateAccount,
      KeyringRpcMethod.DeleteAccount,
      KeyringRpcMethod.ListRequests,
      KeyringRpcMethod.GetRequest,
      KeyringRpcMethod.ApproveRequest,
      KeyringRpcMethod.RejectRequest,
      // Custom methods
      InternalMethod.IsPendingCreation,
    ],
  ],
]);

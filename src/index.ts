import {
  handleKeyringRequest,
} from '@metamask/keyring-api';
import type {
  OnKeyringRequestHandler,
  OnRpcRequestHandler,
} from '@metamask/snaps-types';

import { SimpleKeyring } from './keyring';
import { logger } from './logger';
import { originPermissions } from './permissions';
import { getState } from './stateManagement';

import type { OnTransactionHandler } from '@metamask/snaps-sdk';
import type { OnSignatureHandler } from "@metamask/snaps-sdk";
import { SeverityLevel, panel, text, row, address } from '@metamask/snaps-sdk';
import { remove0x } from '@metamask/utils';
import { hasProperty } from '@metamask/utils';
/**
 * The function signatures for the different types of transactions. This is used
 * to determine the type of transaction. This list is not exhaustive, and only
 * contains the most common types of transactions for demonstration purposes.
 */
const FUNCTION_SIGNATURES = [
  {
    name: 'ERC-20',
    signature: 'a9059cbb',
  },
  {
    name: 'ERC-721',
    signature: '23b872dd',
  },
  {
    name: 'ERC-1155',
    signature: 'f242432a',
  },
];

/**
 * Decode the transaction data. This checks the signature of the function that
 * is being called, and returns the type of transaction.
 * @param data - The transaction data. This is expected to be a hex string,
 * containing the function signature and the parameters.
 * @returns The type of transaction, or "Unknown," if the function signature
 * does not match any known signatures.
 */
export function decodeData(data: string): string {
  const normalisedData = remove0x(data);
  const signature = normalisedData.slice(0, 8);

  const functionSignature = FUNCTION_SIGNATURES.find(
    (value) => value.signature === signature,
  );

  return functionSignature?.name ?? 'Unknown';
}
let keyring: SimpleKeyring;

/**
 * Return the keyring instance. If it doesn't exist, create it.
 * @returns The keyring instance.
 */
async function getKeyring(): Promise<SimpleKeyring> {
  if (!keyring) {
    const state = await getState();
    if (!keyring) {
      keyring = new SimpleKeyring(state);
    }
  }
  return keyring;
}

/**
 * Handle incoming signature requests, sent through one of the following methods:
 * `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4`.
 * The `onSignature` handler is different from the `onRpcRequest` handler in
 * that it is called by MetaMask when a signature request is initiated, rather than
 * when a dapp sends a JSON-RPC request. The handler is called before the
 * signature is made, so it can be used to display information about the
 * signature request to the user before they sign.
 * The `onSignature` handler returns a Snaps UI component, which is displayed
 * in the signature insights panel.
 * @param args - The request parameters.
 * @param args.signature - The signature object. This contains the
 * @returns The signature insights.
 */
export const onSignature: OnSignatureHandler = async ({ signature }) => {

  const { signatureMethod, from, data } = signature;

  switch (signatureMethod) {
    case 'personal_sign':
      return {
        content: panel([row('From:', text(from)), row('Data:', text(data))]),
        severity: SeverityLevel.Critical,
      };

    case 'eth_sign':
    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      throw new Error(`UnSupported signature method: ${signatureMethod}`);
    default:
      throw new Error(`UnSupported signature method`);
  }
};



/**
 * Handle incoming transactions, sent through the `wallet_sendTransaction`
 * method. This handler decodes the transaction data, and displays the type of
 * transaction in the transaction insights panel.
 * The `onTransaction` handler is different from the `onRpcRequest` handler in
 * that it is called by MetaMask when a transaction is initiated, rather than
 * when a dapp sends a JSON-RPC request. The handler is called before the
 * transaction is signed, so it can be used to display information about the
 * transaction to the user before they sign it.
 * The `onTransaction` handler returns a Snaps UI component, which is displayed
 * in the transaction insights panel.
 * @param args - The request parameters.
 * @param args.transaction - The transaction object. This contains the
 * transaction parameters, such as the `from`, `to`, `value`, and `data` fields.
 * @returns The transaction insights.
 */
export const onTransaction: OnTransactionHandler = async ({ transaction }) => {

  if (
    hasProperty(transaction, 'data') &&
    typeof transaction.data === 'string'
  ) {
    const type = decodeData(transaction.data);
    return {
      content: panel([
        row('From', address(transaction.from as `0x${string}`)),
        row(
          'To',
          transaction.to
            ? address(transaction.to as `0x${string}`)
            : text('None'),
        ),
        row('Transaction type', text(type)),
      ]),
      severity: SeverityLevel.Critical,
    };
  }

  return { content: panel([row('Transaction type', text('Unknown'))]) };
};

/**
 * Verify if the caller can call the requested method.
 * @param origin - Caller origin.
 * @param method - Method being called.
 * @returns True if the caller is allowed to call the method, false otherwise.
 */
function hasPermission(origin: string, method: string): boolean {
  return originPermissions.get(origin)?.includes(method) ?? false;
}

export const onRpcRequest: OnRpcRequestHandler = async ({
  origin,
  request,
}) => {
  logger.debug(
    `RPC request (origin="${origin}"):`,
    JSON.stringify(request, undefined, 2),
  );

  // Check if origin is allowed to call method.
  if (!hasPermission(origin, request.method)) {
    throw new Error(
      `Origin '${origin}' is not allowed to call '${request.method}'`,
    );
  }
};

export const onKeyringRequest: OnKeyringRequestHandler = async ({
  origin,
  request,
}) => {
  
  logger.debug(
    `Keyring request (origin="${origin}"):`,
    JSON.stringify(request, undefined, 2),
  );
  // Check if origin is allowed to call method.
  if (!hasPermission(origin, request.method)) {
    throw new Error(
      `Origin '${origin}' is not allowed to call '${request.method}'`,
    );
  }

  // Handle keyring methods.
  return handleKeyringRequest(await getKeyring(), request);
};
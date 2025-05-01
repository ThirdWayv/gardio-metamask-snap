import {
  handleKeyringRequest,
} from '@metamask/keyring-api';
import type {
  OnKeyringRequestHandler,
  OnRpcRequestHandler,
} from '@metamask/snaps-types';

import { SimpleKeyring } from './keyring';
import { logger } from './logger';
import { InternalMethod, originPermissions } from './permissions';
import { getState } from './stateManagement';

import type { OnTransactionHandler } from '@metamask/snaps-sdk';
import type { OnSignatureHandler } from "@metamask/snaps-sdk";
import { SeverityLevel, panel, text } from '@metamask/snaps-sdk';
import { remove0x } from '@metamask/utils';
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
 * The `onSignature` handler returns a Snaps UI component, which is displayed
 * in the signature insights panel.
 * @returns The signature insights.
 */
export const onSignature: OnSignatureHandler = async ({ }) => {

  return {
    content: panel([text('Press "Confirm," then click "Go to website" to review and sign the message on your wallet device.')]),
    severity: SeverityLevel.Critical,
  };
};

/**
 * The `onTransaction` handler returns a Snaps UI component, which is displayed
 * in the transaction insights panel.
 * @returns The transaction insights.
 */
export const onTransaction: OnTransactionHandler = async ({ }) => {

  return {
    content: panel([text('Press "Confirm," then click "Go to website" to review and sign the transaction on your wallet device.')]),
    severity: SeverityLevel.Critical,
  };
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

  // Handle custom method IsPendingCreation.
  if(request.method as InternalMethod === InternalMethod.IsPendingCreation) {
    return (await getKeyring()).IsPendingCreation();
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
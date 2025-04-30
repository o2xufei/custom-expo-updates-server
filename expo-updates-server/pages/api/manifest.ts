import FormData from 'form-data';
import fs from 'fs/promises';
import { NextApiRequest, NextApiResponse } from 'next';
import { serializeDictionary } from 'structured-headers';

import {
  getAssetMetadataAsync,
  getMetadataAsync,
  convertSHA256HashToUUID,
  convertToDictionaryItemsRepresentation,
  signRSASHA256,
  getPrivateKeyAsync,
  getExpoConfigAsync,
  getLatestUpdateBundlePathForRuntimeVersionAsync,
  createRollBackDirectiveAsync,
  NoUpdateAvailableError,
  createNoUpdateAvailableDirectiveAsync,
} from '../../common/helpers';

enum UpdateType {
  NORMAL_UPDATE,
  ROLLBACK,
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': [
    'expo-protocol-version',
    'expo-platform',
    'expo-runtime-version',
    'expo-current-update-id',
    'expo-expect-signature',
  ].join(', '),
  'Access-Control-Max-Age': '86400', // 24小时缓存
};

export default async function manifestEndpoint(req: NextApiRequest, res: NextApiResponse) {
  // 设置CORS头
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  console.log(`[Manifest] Received ${req.method} request from ${req.headers['user-agent']}`);
  console.log(`[Manifest] Headers:`, req.headers);
  console.log(`[Manifest] Query:`, req.query);

  if (req.method !== 'GET') {
    console.error(`[Manifest] Invalid method: ${req.method}`);
    res.statusCode = 405;
    return res.json({ error: 'Expected GET.' });
  }

  const protocolVersionMaybeArray = req.headers['expo-protocol-version'];
  if (protocolVersionMaybeArray && Array.isArray(protocolVersionMaybeArray)) {
    res.statusCode = 400;
    res.json({
      error: 'Unsupported protocol version. Expected either 0 or 1.',
    });
    return;
  }
  const protocolVersion = parseInt(protocolVersionMaybeArray ?? '0', 10);

  const platform = req.headers['expo-platform'] ?? req.query['platform'];
  if (platform !== 'ios' && platform !== 'android') {
    res.statusCode = 400;
    res.json({
      error: 'Unsupported platform. Expected either ios or android.',
    });
    return;
  }

  const runtimeVersion = req.headers['expo-runtime-version'] ?? req.query['runtime-version'];
  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    res.statusCode = 400;
    res.json({
      error: 'No runtimeVersion provided.',
    });
    return;
  }

  let updateBundlePath: string;
  try {
    console.log(
      `[Manifest] Attempting to get update bundle path for runtime version: ${runtimeVersion}`
    );
    updateBundlePath = await getLatestUpdateBundlePathForRuntimeVersionAsync(runtimeVersion);
    console.log(`[Manifest] Found update bundle path: ${updateBundlePath}`);
  } catch (error: any) {
    console.error(`[Manifest] Error getting update bundle path:`, error);
    res.statusCode = 404;
    res.json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return;
  }

  try {
    console.log(`[Manifest] Getting update type for path: ${updateBundlePath}`);
    const updateType = await getTypeOfUpdateAsync(updateBundlePath);
    console.log(`[Manifest] Update type: ${UpdateType[updateType]}`);
    try {
      if (updateType === UpdateType.NORMAL_UPDATE) {
        await putUpdateInResponseAsync(
          req,
          res,
          updateBundlePath,
          runtimeVersion,
          platform,
          protocolVersion
        );
      } else if (updateType === UpdateType.ROLLBACK) {
        await putRollBackInResponseAsync(req, res, updateBundlePath, protocolVersion);
      }
    } catch (maybeNoUpdateAvailableError) {
      if (maybeNoUpdateAvailableError instanceof NoUpdateAvailableError) {
        await putNoUpdateAvailableInResponseAsync(req, res, protocolVersion);
        return;
      }
      throw maybeNoUpdateAvailableError;
    }
  } catch (error) {
    console.error(error);
    res.statusCode = 404;
    res.json({ error });
  }
}
async function getTypeOfUpdateAsync(updateBundlePath: string): Promise<UpdateType> {
  const directoryContents = await fs.readdir(updateBundlePath);
  return directoryContents.includes('rollback') ? UpdateType.ROLLBACK : UpdateType.NORMAL_UPDATE;
}

async function putUpdateInResponseAsync(
  req: NextApiRequest,
  res: NextApiResponse,
  updateBundlePath: string,
  runtimeVersion: string,
  platform: string,
  protocolVersion: number
): Promise<void> {
  // 确保CORS头存在
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  const currentUpdateId = req.headers['expo-current-update-id'];
  const { metadataJson, createdAt, id } = await getMetadataAsync({
    updateBundlePath,
    runtimeVersion,
  });

  // NoUpdateAvailable directive only supported on protocol version 1
  // for protocol version 0, serve most recent update as normal
  if (currentUpdateId === convertSHA256HashToUUID(id) && protocolVersion === 1) {
    throw new NoUpdateAvailableError();
  }

  const expoConfig = await getExpoConfigAsync({
    updateBundlePath,
    runtimeVersion,
  });
  const platformSpecificMetadata = metadataJson.fileMetadata[platform];
  const manifest = {
    id: convertSHA256HashToUUID(id),
    createdAt,
    runtimeVersion,
    assets: await Promise.all(
      (platformSpecificMetadata.assets as any[]).map((asset: any) =>
        getAssetMetadataAsync({
          updateBundlePath,
          filePath: asset.path,
          ext: asset.ext,
          runtimeVersion,
          platform,
          isLaunchAsset: false,
        })
      )
    ),
    launchAsset: await getAssetMetadataAsync({
      updateBundlePath,
      filePath: platformSpecificMetadata.bundle,
      isLaunchAsset: true,
      runtimeVersion,
      platform,
      ext: null,
    }),
    metadata: {},
    extra: {
      expoClient: expoConfig,
    },
  };

  let signature = null;
  const expectSignatureHeader = req.headers['expo-expect-signature'];
  if (expectSignatureHeader) {
    const privateKey = await getPrivateKeyAsync();
    if (!privateKey) {
      res.statusCode = 400;
      res.json({
        error: 'Code signing requested but no key supplied when starting server.',
      });
      return;
    }
    const manifestString = JSON.stringify(manifest);
    const hashSignature = signRSASHA256(manifestString, privateKey);
    const dictionary = convertToDictionaryItemsRepresentation({
      sig: hashSignature,
      keyid: 'main',
    });
    signature = serializeDictionary(dictionary);
  }

  const assetRequestHeaders: { [key: string]: object } = {};
  [...manifest.assets, manifest.launchAsset].forEach((asset) => {
    assetRequestHeaders[asset.key] = {
      'test-header': 'test-header-value',
    };
  });

  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(signature ? { 'expo-signature': signature } : {}),
    },
  });
  form.append('extensions', JSON.stringify({ assetRequestHeaders }), {
    contentType: 'application/json',
  });

  res.statusCode = 200;
  res.setHeader('expo-protocol-version', protocolVersion);
  res.setHeader('expo-sfv-version', 0);
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  res.write(form.getBuffer());
  res.end();
}

async function putRollBackInResponseAsync(
  req: NextApiRequest,
  res: NextApiResponse,
  updateBundlePath: string,
  protocolVersion: number
): Promise<void> {
  if (protocolVersion === 0) {
    throw new Error('Rollbacks not supported on protocol version 0');
  }

  const embeddedUpdateId = req.headers['expo-embedded-update-id'];
  if (!embeddedUpdateId || typeof embeddedUpdateId !== 'string') {
    throw new Error('Invalid Expo-Embedded-Update-ID request header specified.');
  }

  const currentUpdateId = req.headers['expo-current-update-id'];
  if (currentUpdateId === embeddedUpdateId) {
    throw new NoUpdateAvailableError();
  }

  const directive = await createRollBackDirectiveAsync(updateBundlePath);

  let signature = null;
  const expectSignatureHeader = req.headers['expo-expect-signature'];
  if (expectSignatureHeader) {
    const privateKey = await getPrivateKeyAsync();
    if (!privateKey) {
      res.statusCode = 400;
      res.json({
        error: 'Code signing requested but no key supplied when starting server.',
      });
      return;
    }
    const directiveString = JSON.stringify(directive);
    const hashSignature = signRSASHA256(directiveString, privateKey);
    const dictionary = convertToDictionaryItemsRepresentation({
      sig: hashSignature,
      keyid: 'main',
    });
    signature = serializeDictionary(dictionary);
  }

  const form = new FormData();
  form.append('directive', JSON.stringify(directive), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(signature ? { 'expo-signature': signature } : {}),
    },
  });

  res.statusCode = 200;
  res.setHeader('expo-protocol-version', 1);
  res.setHeader('expo-sfv-version', 0);
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  res.write(form.getBuffer());
  res.end();
}

async function putNoUpdateAvailableInResponseAsync(
  req: NextApiRequest,
  res: NextApiResponse,
  protocolVersion: number
): Promise<void> {
  if (protocolVersion === 0) {
    throw new Error('NoUpdateAvailable directive not available in protocol version 0');
  }

  const directive = await createNoUpdateAvailableDirectiveAsync();

  let signature = null;
  const expectSignatureHeader = req.headers['expo-expect-signature'];
  if (expectSignatureHeader) {
    const privateKey = await getPrivateKeyAsync();
    if (!privateKey) {
      res.statusCode = 400;
      res.json({
        error: 'Code signing requested but no key supplied when starting server.',
      });
      return;
    }
    const directiveString = JSON.stringify(directive);
    const hashSignature = signRSASHA256(directiveString, privateKey);
    const dictionary = convertToDictionaryItemsRepresentation({
      sig: hashSignature,
      keyid: 'main',
    });
    signature = serializeDictionary(dictionary);
  }

  const form = new FormData();
  form.append('directive', JSON.stringify(directive), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(signature ? { 'expo-signature': signature } : {}),
    },
  });

  res.statusCode = 200;
  res.setHeader('expo-protocol-version', 1);
  res.setHeader('expo-sfv-version', 0);
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  res.write(form.getBuffer());
  res.end();
}

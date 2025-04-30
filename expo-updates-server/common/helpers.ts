import crypto, { BinaryToTextEncoding } from 'crypto';
import { constants } from 'fs';
import fs from 'fs/promises';
import mime from 'mime';
import path from 'path';
import { Dictionary } from 'structured-headers';

export class NoUpdateAvailableError extends Error {}

function createHash(file: Buffer, hashingAlgorithm: string, encoding: BinaryToTextEncoding) {
  return crypto.createHash(hashingAlgorithm).update(file).digest(encoding);
}

function getBase64URLEncoding(base64EncodedString: string): string {
  return base64EncodedString.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function convertToDictionaryItemsRepresentation(obj: { [key: string]: string }): Dictionary {
  return new Map(
    Object.entries(obj).map(([k, v]) => {
      // 强制键名小写以满足结构化头部规范
      const lowerKey = k.toLowerCase();
      return [lowerKey, [v, new Map()]];
    })
  );
}

export function signRSASHA256(data: string, privateKey: string) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data, 'utf8');
  sign.end();
  return sign.sign(privateKey, 'base64');
}

export async function getPrivateKeyAsync() {
  const privateKeyPath = process.env.PRIVATE_KEY_PATH;
  if (!privateKeyPath) {
    return null;
  }

  const pemBuffer = await fs.readFile(path.resolve(privateKeyPath));
  return pemBuffer.toString('utf8');
}

export async function getLatestUpdateBundlePathForRuntimeVersionAsync(runtimeVersion: string) {
  try {
    const updatesDirectoryForRuntimeVersion = path.join(process.cwd(), 'updates', runtimeVersion);
    
    // 检查目录是否存在并且可访问
    try {
      await fs.access(updatesDirectoryForRuntimeVersion, constants.R_OK);
    } catch (error) {
      console.error(`Directory access error: ${error}`);
      throw new Error(`Unsupported runtime version or directory access denied: ${runtimeVersion}`);
    }

    const filesInUpdatesDirectory = await fs.readdir(updatesDirectoryForRuntimeVersion);
    if (!filesInUpdatesDirectory.length) {
      throw new Error(`No updates found for runtime version: ${runtimeVersion}`);
    }

    const directoriesInUpdatesDirectory = (
      await Promise.all(
        filesInUpdatesDirectory.map(async (file) => {
          try {
            const filePath = path.join(updatesDirectoryForRuntimeVersion, file);
            const fileStat = await fs.stat(filePath);
            return fileStat.isDirectory() ? file : null;
          } catch (error) {
            console.error(`Error processing file ${file}: ${error}`);
            return null;
          }
        })
      )
    )
      .filter(truthy)
      .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

    if (!directoriesInUpdatesDirectory.length) {
      throw new Error(`No valid update directories found for runtime version: ${runtimeVersion}`);
    }

    const latestUpdatePath = path.join(updatesDirectoryForRuntimeVersion, directoriesInUpdatesDirectory[0]);
    
    // 验证最新更新目录的内容
    try {
      await fs.access(path.join(latestUpdatePath, 'metadata.json'), constants.R_OK);
    } catch (error) {
      console.error(`Metadata file access error: ${error}`);
      throw new Error(`Latest update directory is invalid or incomplete: ${latestUpdatePath}`);
    }

    return latestUpdatePath;
  } catch (error) {
    console.error(`Error in getLatestUpdateBundlePathForRuntimeVersionAsync: ${error}`);
    throw error;
  }
}

type GetAssetMetadataArg =
  | {
      updateBundlePath: string;
      filePath: string;
      ext: null;
      isLaunchAsset: true;
      runtimeVersion: string;
      platform: string;
    }
  | {
      updateBundlePath: string;
      filePath: string;
      ext: string;
      isLaunchAsset: false;
      runtimeVersion: string;
      platform: string;
    };

export async function getAssetMetadataAsync(arg: GetAssetMetadataArg) {
  const assetFilePath = `${arg.updateBundlePath}/${arg.filePath}`;
  const asset = await fs.readFile(path.resolve(assetFilePath), null);
  const assetHash = getBase64URLEncoding(createHash(asset, 'sha256', 'base64'));
  const key = createHash(asset, 'md5', 'hex');
  const keyExtensionSuffix = arg.isLaunchAsset ? 'bundle' : arg.ext;
  const contentType = arg.isLaunchAsset ? 'application/javascript' : mime.getType(arg.ext);

  return {
    hash: assetHash,
    key,
    fileExtension: `.${keyExtensionSuffix}`,
    contentType,
    url: `${process.env.HOSTNAME}/api/assets?asset=${assetFilePath}&runtimeVersion=${arg.runtimeVersion}&platform=${arg.platform}`,
  };
}

export async function createRollBackDirectiveAsync(updateBundlePath: string) {
  try {
    const rollbackFilePath = `${updateBundlePath}/rollback`;
    const rollbackFileStat = await fs.stat(rollbackFilePath);
    return {
      type: 'rollBackToEmbedded',
      parameters: {
        commitTime: new Date(rollbackFileStat.birthtime).toISOString(),
      },
    };
  } catch (error) {
    throw new Error(`No rollback found. Error: ${error}`);
  }
}

export async function createNoUpdateAvailableDirectiveAsync() {
  return {
    type: 'noUpdateAvailable',
  };
}

export async function getMetadataAsync({
  updateBundlePath,
  runtimeVersion,
}: {
  updateBundlePath: string;
  runtimeVersion: string;
}) {
  try {
    const metadataPath = `${updateBundlePath}/metadata.json`;
    const updateMetadataBuffer = await fs.readFile(path.resolve(metadataPath), null);
    const metadataJson = JSON.parse(updateMetadataBuffer.toString('utf-8'));
    const metadataStat = await fs.stat(metadataPath);

    return {
      metadataJson,
      createdAt: new Date(metadataStat.birthtime).toISOString(),
      id: createHash(updateMetadataBuffer, 'sha256', 'hex'),
    };
  } catch (error) {
    throw new Error(`No update found with runtime version: ${runtimeVersion}. Error: ${error}`);
  }
}

/**
 * This adds the `@expo/config`-exported config to `extra.expoConfig`, which is a common thing
 * done by implementors of the expo-updates specification since a lot of Expo modules use it.
 * It is not required by the specification, but is included here in the example client and server
 * for demonstration purposes. EAS Update does something conceptually very similar.
 */
export async function getExpoConfigAsync({
  updateBundlePath,
  runtimeVersion,
}: {
  updateBundlePath: string;
  runtimeVersion: string;
}): Promise<any> {
  try {
    const expoConfigPath = `${updateBundlePath}/expoConfig.json`;
    const expoConfigBuffer = await fs.readFile(path.resolve(expoConfigPath), null);
    const expoConfigJson = JSON.parse(expoConfigBuffer.toString('utf-8'));
    return expoConfigJson;
  } catch (error) {
    throw new Error(
      `No expo config json found with runtime version: ${runtimeVersion}. Error: ${error}`
    );
  }
}

export function convertSHA256HashToUUID(value: string) {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(
    16,
    20
  )}-${value.slice(20, 32)}`;
}

export function truthy<TValue>(value: TValue | null | undefined): value is TValue {
  return !!value;
}
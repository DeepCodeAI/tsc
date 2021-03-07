/* eslint-disable no-await-in-loop */
import chunk from 'lodash.chunk';

import { IFileInfo } from './interfaces/files.interface';

import { composeFilePayloads, resolveBundleFiles } from './files';
import {
  CreateBundleErrorCodes,
  CheckBundleErrorCodes,
  ExtendBundleErrorCodes,
  createBundle,
  extendBundle,
  checkBundle,
  uploadFiles,
  IResult,
  RemoteBundle,
} from './http';
import { MAX_PAYLOAD, MAX_UPLOAD_ATTEMPTS } from './constants';
import emitter from './emitter';
import { fromEntries } from './lib/utils';

type BundleErrorCodes = CreateBundleErrorCodes | CheckBundleErrorCodes | ExtendBundleErrorCodes;

async function prepareRemoteBundle(
  baseURL: string,
  sessionToken: string,
  files: IFileInfo[],
  removedFiles: string[] = [],
  existingBundleId: string | null = null,
  maxPayload = MAX_PAYLOAD,
  source: string,
): Promise<IResult<RemoteBundle, CreateBundleErrorCodes>[]> {
  const res = []
  let response: IResult<RemoteBundle, BundleErrorCodes>;
  let bundleId = existingBundleId;

  const fileChunks = chunk(files, maxPayload / 300);
  emitter.createBundleProgress(0, fileChunks.length);
  for (const [i, chunkedFiles] of fileChunks.entries()) {
    const paramFiles = fromEntries(chunkedFiles.map(d => [d.bundlePath, d.hash]));

    if (bundleId === null) {
      // eslint-disable-next-line no-await-in-loop
      response = await createBundle({
        baseURL,
        sessionToken,
        files: paramFiles,
        source,
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      response = await extendBundle({
        baseURL,
        sessionToken,
        bundleId,
        files: paramFiles,
        removedFiles,
      });
    }

    emitter.createBundleProgress(i + 1, fileChunks.length);

    if (response.type === 'error') {
      // TODO: process Error
      res.push(response);
      break;
    }
    bundleId = response.value.bundleId;

    res.push(response);
  }
  return res;
}

/**
 * Splits files in buckets and upload in parallel
 * @param baseURL
 * @param sessionToken
 * @param remoteBundle
 */
export async function uploadRemoteBundle(
  baseURL: string,
  sessionToken: string,
  bundleId: string,
  files: IFileInfo[],
  maxPayload = MAX_PAYLOAD,
): Promise<boolean> {
  let uploadedFiles = 0;
  emitter.uploadBundleProgress(0, files.length);

  const uploadFileChunks = async (bucketFiles: IFileInfo[]): Promise<boolean> => {
    const resp = await uploadFiles({
      baseURL,
      sessionToken,
      bundleId,
      content: bucketFiles.map(f => {
        return { fileHash: f.hash, fileContent: f.content || '' };
      }),
    });

    if (resp.type !== 'error') {
      uploadedFiles += bucketFiles.length;
      emitter.uploadBundleProgress(uploadedFiles, files.length);
      return true;
    }

    return false;
  };

  const tasks = [];
  for (const bucketFiles of composeFilePayloads(files, maxPayload)) {
    tasks.push(uploadFileChunks(bucketFiles));
  }

  if (tasks.length) {
    return (await Promise.all(tasks)).some(r => !!r);
  }
  return true;
}

async function fullfillRemoteBundle(
  baseURL: string,
  sessionToken: string,
  baseDir: string,
  remoteBundle: RemoteBundle,
  maxPayload = MAX_PAYLOAD,
  maxAttempts = MAX_UPLOAD_ATTEMPTS,
): Promise<RemoteBundle> {
  // Fulfill remote bundle by uploading only missing files (splitted in chunks)
  // Check remove bundle to make sure no missing files left
  let attempts = 0;
  while (remoteBundle.missingFiles.length && attempts < maxAttempts) {
    const missingFiles = await resolveBundleFiles(baseDir, remoteBundle.missingFiles);
    const isUploaded = await uploadRemoteBundle(baseURL, sessionToken, remoteBundle.bundleId, missingFiles, maxPayload);
    if (!isUploaded) {
      throw new Error('Failed to upload some files');
    }
    const bundleResponse = await checkBundle({
      baseURL,
      sessionToken,
      bundleId: remoteBundle.bundleId,
    });
    if (bundleResponse.type === 'error') {
      throw new Error('Failed to get remote bundle');
    }
    // eslint-disable-next-line no-param-reassign
    remoteBundle = bundleResponse.value;
    attempts += 1;
  }
  return remoteBundle;
}

export async function remoteBundleFactory(
  baseURL: string,
  sessionToken: string,
  files: IFileInfo[],
  removedFiles: string[] = [],
  baseDir: string,
  existingBundleId: string | null = null,
  maxPayload = MAX_PAYLOAD,
  source: string,
): Promise<RemoteBundle | null> {
  const bundleFactory = await prepareRemoteBundle(
    baseURL,
    sessionToken,
    files,
    removedFiles,
    existingBundleId,
    maxPayload,
    source,
  );
  let remoteBundle: RemoteBundle | null = null;

  for (const response of bundleFactory) {
    if (response.type === 'error') {
      throw response.error;
    }

    remoteBundle = await fullfillRemoteBundle(baseURL, sessionToken, baseDir, response.value, maxPayload);
    if (remoteBundle.missingFiles.length) {
      throw new Error(`Failed to upload # files: ${remoteBundle.missingFiles.length}`);
    }
  }

  return remoteBundle;
}

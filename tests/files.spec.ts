import * as fs from 'fs';
import * as nodePath from 'path';

import {
  collectIgnoreRules,
  collectBundleFiles,
  prepareExtendingBundle,
  composeFilePayloads,
  parseFileIgnores,
  getFileInfo,
} from '../src/files';

import {
  sampleProjectPath,
  supportedFiles,
  bundleFiles,
  bundleFilePaths,
  bundleFilesFull,
  bundleFileIgnores,
} from './constants/sample';

describe('files', () => {
  it('parse dc ignore file', () => {
    const patterns = parseFileIgnores(`${sampleProjectPath}/.dcignore`);
    expect(patterns).toEqual(bundleFileIgnores.slice(1));
  });

  it('collect ignore rules', async () => {
    const ignoreRules = await collectIgnoreRules([sampleProjectPath]);
    expect(ignoreRules).toEqual(bundleFileIgnores);
  });

  it('collect bundle files', async () => {
    // TODO: We should introduce some performance test using a big enough repo to avoid flaky results
    const collector = collectBundleFiles(sampleProjectPath, [sampleProjectPath], supportedFiles, bundleFileIgnores);
    const files = [];
    for await (const f of collector) {
      files.push(f);
    }
    expect(files).toEqual(await bundleFiles);

    const testFile = files[1];
    expect(testFile.bundlePath).toEqual('/AnnotatorTest.cpp');
    expect(testFile.hash).toEqual('61b028b49c2a4513b1c7c161b5f491264fe71c9c29bc0ae8e6d760c156b45edc');
    expect(testFile.filePath).toEqual(`${sampleProjectPath}/AnnotatorTest.cpp`);
    expect(testFile.size).toEqual(239);
  });

  it('extend bundle files', async () => {
    const testNewFiles = [
      `${sampleProjectPath}/app.js`,
      `${sampleProjectPath}/not/ignored/this_should_not_be_ignored.java`,
    ];
    const testRemovedFiles = [
      `${sampleProjectPath}/removed_from_the_parent_bundle.java`,
      `${sampleProjectPath}/ignored/this_should_be_ignored.java`,
    ];
    const parentBundle = [...testNewFiles, ...testRemovedFiles];
    const { files, removedFiles } = await prepareExtendingBundle(
      sampleProjectPath,
      parentBundle,
      supportedFiles,
      bundleFileIgnores,
    );
    expect(files).toEqual((await bundleFiles).filter(obj => testNewFiles.includes(obj.filePath)));
    expect(removedFiles).toEqual(['/removed_from_the_parent_bundle.java']);
  });

  it('collect bundle files with small max payload', async () => {
    // Limit size and we get fewer files
    const collector = collectBundleFiles(
      sampleProjectPath,
      [sampleProjectPath],
      supportedFiles,
      bundleFileIgnores,
      500,
    );
    const smallFiles = [];
    for await (const f of collector) {
      smallFiles.push(f);
    }
    expect(smallFiles.length).toEqual(5);
  });

  it('collect bundle files with multiple folders', async () => {
    // Limit size and we get fewer files
    const folders = [nodePath.join(sampleProjectPath, 'models'), nodePath.join(sampleProjectPath, 'controllers')];
    const collector = collectBundleFiles(sampleProjectPath, folders, supportedFiles);
    const smallFiles = [];
    for await (const f of collector) {
      smallFiles.push(f);
    }
    expect(smallFiles.length).toEqual(2);
    expect(smallFiles.map(f => [f.filePath, f.bundlePath])).toEqual([
      [`${sampleProjectPath}/models/sharks.js`, '/models/sharks.js'],
      [`${sampleProjectPath}/controllers/sharks.js`, '/controllers/sharks.js'],
    ]);
  });

  it('compose file payloads', async () => {
    // Prepare all missing files first
    const payloads = [...composeFilePayloads(await bundleFilesFull, 1024)];
    expect(payloads.length).toEqual(5); // 5 chunks
    expect(payloads[0].length).toEqual(4);

    const testPayload = payloads[0][1];
    expect(testPayload.filePath).toEqual(`${sampleProjectPath}/AnnotatorTest.cpp`);
    expect(testPayload.bundlePath).toEqual(`/AnnotatorTest.cpp`);
    expect(testPayload.size).toEqual(239);
    expect(testPayload.hash).toEqual('61b028b49c2a4513b1c7c161b5f491264fe71c9c29bc0ae8e6d760c156b45edc');
    expect(testPayload.content).toEqual(fs.readFileSync(testPayload.filePath).toString('utf8'));
  });

  it('support of utf-8 encoding', async () => {
    // fs.readFileSync(payloads[0][0].path).toString('utf8')
    const filePath = `${sampleProjectPath}/app.js`;
    const fileMeta = await getFileInfo(filePath, sampleProjectPath);
    expect(fileMeta?.hash).toEqual('40f937553fda7b9986c3a87d39802b96e77fb2ba306dd602f9b2d28949316c98');
  });

  it('support of iso8859 encoding', async () => {
    const filePath = `${sampleProjectPath}/main.js`;
    const fileMeta = await getFileInfo(filePath, sampleProjectPath);
    expect(fileMeta?.hash).toEqual('3e2979852cc2e97f48f7e7973a8b0837eb73ed0485c868176bc3aa58c499f534');
  });
});

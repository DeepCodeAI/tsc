import {
  AnalysisStatus,
  checkBundle,
  checkSession,
  createBundle,
  createGitBundle,
  extendBundle,
  getAnalysis,
  getFilters,
  getIpFamily,
  reportError,
  reportEvent,
  startSession,
  uploadFiles,
} from '../src/http';
import { fromEntries } from '../src/lib/utils';
import { authHost, baseURL, sessionToken, TEST_TIMEOUT } from './constants/base';
import { bundleFiles, bundleFilesFull } from './constants/sample';

const fakeBundleId = 'c58d69bd4fd65c45b1112bd7b45f028e614d443fc123901fd1aba15856c13c27';
let fakeBundleIdFull = '';
const realBundleId = 'c3a31c6c503b76ce51e2f8f7db9aa8f26715e6367124ce6e2f419087cad011b0';
let realBundleIdFull = '';
const extendedBundleId = '587a6bcb0095606ad57ccc7bb7ac6401475ce4181c13f7136491a16df06544f1';

const fakeMissingFiles = [
  `/AnnotatorTest.cpp`,
  `/GitHubAccessTokenScrambler12.java`,
  `/app.js`,
  `/db.js`,
  `/main.js`,
  // TODO: This should be ignored
  `/not/ignored/this_should_be_ignored.jsx`,
  `/not/ignored/this_should_not_be_ignored.java`,
  `/routes/index.js`,
  `/routes/sharks.js`,
];

const reportTelemetryRequest = {
  baseURL,
  sessionToken,
  bundleId: fakeBundleId,
  source: 'testSource',
  type: 'testType',
  message: 'testMessage',
  path: '/test/path',
  data: {
    foo: 'bar',
    bar: ['fo', 'foo', 'fooo'],
  },
};

describe('Requests to public API', () => {
  it('gets filters successfully', async () => {
    const response = await getFilters(baseURL, '');
    expect(response.type).toEqual('success');
    if (response.type === 'error') return;
    expect(new Set(response.value.configFiles)).toEqual(new Set(['.dcignore', '.gitignore']));
    expect(new Set(response.value.extensions)).toEqual(
      new Set([
        '.CS',
        '.Cs',
        '.c',
        '.cc',
        '.cpp',
        '.cs',
        '.cxx',
        '.es',
        '.es6',
        '.h',
        '.hpp',
        '.htm',
        '.html',
        '.hxx',
        '.java',
        '.js',
        '.jsx',
        '.php',
        '.py',
        '.ts',
        '.tsx',
        '.vue',
      ]),
    );
  });

  it('reports error successfully', async () => {
    const response = await reportError(reportTelemetryRequest);
    expect(response.type).toEqual('success');
  });

  it('reports event successfully', async () => {
    const response = await reportEvent(reportTelemetryRequest);
    expect(response.type).toEqual('success');
  });

  it('starts session successfully', async () => {
    const ipFamily = await getIpFamily(authHost);

    const startSessionResponse = startSession({
      source: 'atom',
      authHost,
    });
    expect(startSessionResponse.loginURL).toMatch(/.*\/login\?token=.*&utm_source=atom/);
    const draftToken = startSessionResponse.draftToken;

    // This token is just a draft and not ready to be used permanently
    const checkSessionResponse = await checkSession({ authHost, draftToken, ipFamily });
    expect(checkSessionResponse.type).toEqual('success');
    if (checkSessionResponse.type == 'error') return;
    expect(checkSessionResponse.value).toEqual('');
  });

  it('checks session unsuccessfully', async () => {
    const response = await checkSession({
      authHost,
      draftToken: 'dummy-token',
    });
    expect(response.type).toEqual('success');
    if (response.type === 'error') return;
    expect(response.value).toEqual('');
  });

  // TODO: find a way to test successfull workflow automatically
  // it('checks session successfully', async () => {
  //   const response = await checkSession({
  //     authHost,
  //     sessionToken,
  //   });
  //   expect(response.type).toEqual('success');
  //   if (response.type === 'error') return;
  //   expect(response.value).toEqual(true);
  // });

  it(
    'creates bundle successfully',
    async () => {
      const files = fromEntries([...(await bundleFiles).entries()].map(([i, d]) => [d.bundlePath, `${i}`]));

      const response = await createBundle({
        baseURL,
        sessionToken,
        files,
        source: 'atom',
      });
      expect(response.type).toEqual('success');
      if (response.type === 'error') return;
      expect(response.value.bundleId).toContain(fakeBundleId);
      fakeBundleIdFull = response.value.bundleId;
      expect(response.value.missingFiles).toEqual(fakeMissingFiles);
    },
    TEST_TIMEOUT,
  );

  it(
    'checks bundle successfully',
    async () => {
      const response = await checkBundle({
        baseURL,
        sessionToken,
        bundleId: fakeBundleIdFull,
      });
      expect(response.type).toEqual('success');
      if (response.type === 'error') return;
      expect(response.value.bundleId).toEqual(fakeBundleIdFull);
      expect(response.value.missingFiles).toEqual(fakeMissingFiles);
    },
    TEST_TIMEOUT,
  );

  it(
    'checks expired bundle successfully',
    async () => {
      const response = await checkBundle({
        baseURL,
        sessionToken,
        bundleId: 'mock-expired-bundle-id',
      });
      expect(response.type).toEqual('error');
      // dummy to cheat typescript compiler
      if (response.type == 'success') return;
      expect(response.error.statusCode).toEqual(404);
      expect(response.error.statusText).toEqual('Uploaded bundle has expired');
    },
    TEST_TIMEOUT,
  );

  it(
    'request analysis with missing files',
    async () => {
      let response;
      do {
        response = await getAnalysis({
          baseURL,
          sessionToken,
          bundleId: fakeBundleIdFull,
          includeLint: false,
          severity: 1,
          source: 'atom',
        });
      } while (response.type === 'success');

      expect(response.type).toEqual('error');
      expect(response.error).toEqual({
        apiName: 'getAnalysis',
        statusCode: 404,
        statusText: 'Not found',
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'extends bundle successfully',
    async () => {
      const response = await extendBundle({
        baseURL,
        sessionToken,
        bundleId: fakeBundleIdFull,
        files: {
          [`/new.js`]: 'new123',
        },
        removedFiles: [
          `/AnnotatorTest.cpp`,
          `/app.js`,
          `/GitHubAccessTokenScrambler12.java`,
          `/db.js`,
          `/main.js`,
          `/not/ignored/this_should_be_ignored.jsx`,
          `/not/ignored/this_should_not_be_ignored.java`,
          `/routes/index.js`,
          `/routes/sharks.js`,
        ],
      });
      expect(response.type).toEqual('success');
      if (response.type === 'error') return;
      expect(response.value.bundleId).toContain(extendedBundleId);
      expect(response.value.missingFiles).toEqual([`/new.js`]);
    },
    TEST_TIMEOUT,
  );

  it(
    'extends expired bundle successfully',
    async () => {
      const response = await extendBundle({
        baseURL,
        sessionToken,
        bundleId: 'wrong-bundle-id',
        files: {
          [`/new2.js`]: 'new1234',
        },
      });

      expect(response.type).toEqual('error');
      // dummy to cheat typescript compiler
      if (response.type == 'success') return;

      expect(response.error.statusCode).toEqual(404);
      expect(response.error.statusText).toEqual('Parent bundle has expired');
    },
    TEST_TIMEOUT,
  );

  it(
    'uploads fake files to fake bundle',
    async () => {
      const response = await uploadFiles({
        baseURL,
        sessionToken,
        bundleId: fakeBundleIdFull,
        content: [
          {
            fileHash: 'df',
            fileContent: 'const module = new Module();',
          },
          {
            fileHash: 'sdfs',
            fileContent: 'const App = new App();',
          },
        ],
      });
      expect(response.type).toEqual('error');
      if (response.type === 'success') return;
      expect(response.error).toEqual({
        apiName: 'uploadFiles',
        statusCode: 400,
        statusText:
          'Invalid request, attempted to extend a git bundle, or ended up with an empty bundle after the extension',
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'test successful workflow with and without linters',
    async () => {
      // Create a bundle first
      const files = fromEntries((await bundleFilesFull).map(d => [d.bundlePath, d.hash]));

      const bundleResponse = await createBundle({
        baseURL,
        sessionToken,
        files,
        source: 'atom',
      });
      expect(bundleResponse.type).toEqual('success');
      if (bundleResponse.type === 'error') return;
      expect(bundleResponse.value.bundleId).toContain(realBundleId);
      realBundleIdFull = bundleResponse.value.bundleId;

      const content = (await bundleFilesFull).map(d => {
        return {
          fileHash: d.hash,
          fileContent: d.content || '',
        };
      });

      // Upload files
      const uploadResponse = await uploadFiles({
        baseURL,
        sessionToken,
        bundleId: realBundleIdFull,
        content: content,
      });
      expect(uploadResponse.type).toEqual('success');
      if (uploadResponse.type === 'error') return;
      expect(uploadResponse.value).toEqual(true);

      // Check missing files
      const checkResponse = await checkBundle({
        baseURL,
        sessionToken,
        bundleId: realBundleIdFull,
      });
      expect(checkResponse.type).toEqual('success');
      if (checkResponse.type === 'error') return;
      expect(checkResponse.value.bundleId).toEqual(realBundleIdFull);
      expect(checkResponse.value.missingFiles).toEqual([]);

      // Get analysis results without linters
      let response = await getAnalysis({
        baseURL,
        sessionToken,
        bundleId: realBundleIdFull,
        includeLint: false,
        severity: 1,
        source: 'atom',
      });
      expect(response.type).toEqual('success');
      if (response.type === 'error') return;
      expect(response.value.status !== AnalysisStatus.failed).toBeTruthy();

      if (response.value.status === AnalysisStatus.done) {
        expect(response.value.analysisURL.includes(realBundleIdFull)).toBeTruthy();
        expect(Object.keys(response.value.analysisResults.suggestions).length).toEqual(8);
        const suggestion = response.value.analysisResults.suggestions[0];
        expect(Object.keys(suggestion)).toEqual([
          'id',
          'rule',
          'message',
          'severity',
          'lead_url',
          'leadURL',
          'categories',
          'tags',
          'title',
          'cwe',
          'text',
          'repoDatasetSize',
          'exampleCommitDescriptions',
          'exampleCommitFixes',
        ]);
        expect(suggestion.id).toEqual('javascript%2Fdc_interfile_project%2FDisablePoweredBy');
        expect(suggestion.leadURL).toEqual(
          'http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header',
        );
        expect(suggestion.repoDatasetSize).toEqual(874);
        expect(suggestion.exampleCommitDescriptions).toEqual([
          'Test without express',
          '/server tests ()',
          'secure the api with helmet',
        ]);
        expect(suggestion.exampleCommitFixes.length).toEqual(3);
        expect(suggestion.message).toEqual(
          'Disable X-Powered-By header for your Express app (consider using Helmet middleware), because it exposes information about the used framework to potential attackers.',
        );
        expect(suggestion.rule).toEqual('DisablePoweredBy');
        expect(suggestion.severity).toEqual(2);

        expect(suggestion.tags).toEqual(['maintenance', 'express', 'server', 'helmet']);
        expect(Object.keys(response.value.analysisResults.files).length).toEqual(5);
        expect(response.value.analysisResults.timing.analysis).toBeGreaterThanOrEqual(
          response.value.analysisResults.timing.fetchingCode,
        );
        const filePath = `/GitHubAccessTokenScrambler12.java`;
        expect(response.value.analysisResults.files[filePath]).toMatchSnapshot();
        expect(response.value.analysisResults.timing.queue).toBeGreaterThanOrEqual(0);
        expect(new Set(response.value.analysisResults.coverage)).toEqual(
          new Set([
            {
              files: 2,
              isSupported: true,
              lang: 'Java',
            },
            {
              files: 1,
              isSupported: true,
              lang: 'C++ (beta)',
            },
            {
              files: 5,
              isSupported: true,
              lang: 'JavaScript',
            },
            {
              files: 1,
              isSupported: true,
              lang: 'JSX',
            },
          ]),
        );
      }

      // Get analysis results limited to 1 file
      do {
        response = await getAnalysis({
          baseURL,
          sessionToken,
          bundleId: realBundleIdFull,
          includeLint: false,
          severity: 1,
          limitToFiles: [`/GitHubAccessTokenScrambler12.java`],
          source: 'atom',
        });

        expect(response.type).toEqual('success');
        if (response.type === 'error') return;
        expect(response.value.status !== AnalysisStatus.failed).toBeTruthy();
      } while (response.value.status !== AnalysisStatus.done);

      expect(Object.keys(response.value.analysisResults.suggestions).length).toEqual(4);
      expect(new Set(Object.keys(response.value.analysisResults.files))).toEqual(
        new Set(['/GitHubAccessTokenScrambler12.java', '/not/ignored/this_should_not_be_ignored.java']),
      );

      // Get analysis results without linters but with severity 3
      do {
        response = await getAnalysis({
          baseURL,
          sessionToken,
          bundleId: realBundleIdFull,
          includeLint: false,
          severity: 3,
          source: 'atom',
        });
        expect(response.type).toEqual('success');
        if (response.type === 'error') return;
        expect(response.value.status !== AnalysisStatus.failed).toBeTruthy();
      } while (response.value.status !== AnalysisStatus.done);

      expect(Object.keys(response.value.analysisResults.suggestions).length).toEqual(2);
      expect(new Set(Object.keys(response.value.analysisResults.files))).toEqual(
        new Set(['/GitHubAccessTokenScrambler12.java', '/not/ignored/this_should_not_be_ignored.java']),
      );
    },
    TEST_TIMEOUT,
  );

  describe('git analysis', () => {
    let goofBundleId: string;

    it('create git bundle', async () => {
      const bundleResponse = await createGitBundle({
        baseURL,
        sessionToken,
        gitUri: 'git@github.com:snyk/goof.git@5a4f50e747dca50e3e54b47b3a3d5e52d481d31c',
        source: 'atom',
      });
      expect(bundleResponse.type).toEqual('success');
      if (bundleResponse.type === 'error') return;
      expect(bundleResponse.value.bundleId).toBeTruthy();
      goofBundleId = bundleResponse.value.bundleId;
    });

    it(
      'git analysis',
      async () => {
        // Get analysis results
        const response = await getAnalysis({
          baseURL,
          sessionToken,
          bundleId: goofBundleId,
          includeLint: false,
          severity: 1,
          source: 'atom',
        });
        expect(response.type).toEqual('success');
        if (response.type === 'error') return;
        expect(response.value.status !== AnalysisStatus.failed).toBeTruthy();

        if (response.value.status === AnalysisStatus.done) {
          expect(response.value.analysisURL.includes(goofBundleId)).toBeTruthy();
          expect(response.value.analysisResults.suggestions).toBeTruthy();

          const suggestion = response.value.analysisResults.suggestions[0];
          expect(suggestion.categories).toEqual(['Security']);
          expect(suggestion).toHaveProperty('exampleCommitDescriptions');
          expect(suggestion).toHaveProperty('exampleCommitFixes');
          expect(suggestion.leadURL).toEqual('');
          expect(suggestion.id).toEqual('javascript%2Fdc_interfile_project%2FHttpToHttps');
          expect(suggestion.message).toContain(
            'http (used in require) is an insecure protocol and should not be used in new code.',
          );
          expect(suggestion.rule).toEqual('HttpToHttps');
          expect(suggestion.severity).toEqual(2);
          expect(suggestion.tags).toEqual(['maintenance', 'http', 'server']);
          expect(Object.keys(response.value.analysisResults.files).length).toEqual(4);
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'git analysis with reachability flag',
      async () => {
        const response = await getAnalysis({
          baseURL,
          sessionToken,
          bundleId: goofBundleId,
          includeLint: false,
          severity: 1,
          source: 'atom',
          reachability: true,
        });
        expect(response.type).toEqual('success');
        if (response.type === 'error') return;
        expect(response.value.status !== AnalysisStatus.failed).toBeTruthy();

        if (response.value.status === AnalysisStatus.done) {
          expect(response.value.analysisURL.includes(goofBundleId)).toBeTruthy();
          expect(response.value.analysisResults.suggestions).toBeTruthy();

          expect(response.value.analysisResults.coverage).toEqual(
            expect.arrayContaining([
              {
                files: 8,
                isSupported: true,
                lang: 'JavaScript',
              },
              {
                files: 1,
                isSupported: true,
                lang: 'HTML',
              },
            ]),
          );
        }
      },
      TEST_TIMEOUT,
    );
  });

  it(
    'git analysis with empty results',
    async () => {
      const bundleId = 'gh/DeepcodeAI/test-bigfiles/e7633ef98fba3ddc24e5bea27ae58d5b08b2f949';

      let response;

      do {
        // Get analysis results
        response = await getAnalysis({
          baseURL,
          sessionToken,
          bundleId,
          includeLint: false,
          severity: 1,
          source: 'atom',
        });

        expect(response.type).toEqual('success');
        if (response.type === 'error') return;
        expect(response.value.status !== AnalysisStatus.failed).toBeTruthy();
      } while (response.value.status !== AnalysisStatus.done);

      expect(response.value.analysisURL.includes(bundleId)).toBeTruthy();
      expect(response.value.analysisResults.suggestions).toEqual({});
      expect(response.value.analysisResults.files).toEqual({});

      expect(response.value.analysisResults.coverage).toEqual([
        {
          files: 3,
          isSupported: false,
          lang: 'Text',
        },
        {
          files: 1,
          isSupported: false,
          lang: 'Markdown',
        },
      ]);
    },
    TEST_TIMEOUT,
  );
});

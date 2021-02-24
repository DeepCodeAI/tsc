// eslint-disable-next-line import/no-unresolved
import { Log, ReportingConfiguration, ReportingDescriptor, Result } from 'sarif';

import { IAnalysisResult, IFileSuggestion, RuleProperties } from './interfaces/analysis-result.interface';

interface Fingerprint {
  version: number;
  fingerprint: string;
}

interface ISarifSuggestion extends IFileSuggestion {
  id: string;
  ruleIndex: number;
  rule: ReportingDescriptor;
  level: ReportingConfiguration.level;
  text: string;
  file: string;
  fingerprints: Fingerprint[];
}

interface ISarifSuggestions {
  [suggestionIndex: number]: ISarifSuggestion;
}

export default function getSarif(analysisResults: IAnalysisResult): Log {
  const { tool, suggestions } = getTools(analysisResults, getSuggestions(analysisResults));
  const results = getResults(suggestions);
  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool,
        results,
        properties: {
          coverage: analysisResults.coverage,
        },
      },
    ],
  };
}

const getSuggestions = (analysisResults: IAnalysisResult): ISarifSuggestions => {
  const suggestions = {};
  for (const [file] of Object.entries(analysisResults.files)) {
    for (const [issueId, issues] of Object.entries(analysisResults.files[file])) {
      if (!suggestions || !Object.keys(suggestions).includes(issueId)) {
        suggestions[issueId] = { ...issues[0], file: file.substring(1) };
      }
    }
  }
  return suggestions;
};

const getTools = (analysisResults: IAnalysisResult, suggestions: ISarifSuggestions) => {
  const output = { driver: { name: 'SnykCode', semanticVersion: '1.0.0', version: '1.0.0' } };
  const rules = [];
  let ruleIndex = 0;
  const result: ISarifSuggestions = {};
  for (const [suggestionIndex, suggestion] of Object.entries(analysisResults.suggestions)) {
    const severity = <Result.level>{
      1: 'note',
      2: 'warning',
      3: 'error',
    }[suggestion.severity];
    // payload comes as URIencoded
    const language = suggestion.id.split('%2F')[0];
    const suggestionId = `${language}/${suggestion.rule}`;
    const ruleProperties: RuleProperties = {
      tags: [language, ...suggestion.tags, ...suggestion.categories],
      exampleCommitFixes: suggestion.exampleCommitFixes,
      exampleCommitDescriptions: suggestion.exampleCommitDescriptions,
      precision: 'very-high'
    };

    const rule = {
      id: suggestionId,
      name: suggestion.rule,
      shortDescription: {
        text: suggestion.title || suggestion.rule,
      },
      defaultConfiguration: {
        level: severity,
      },
      help: {
        markdown: suggestion.text,
        text: '',
      },
      properties: ruleProperties
    };

    if (suggestion.cwe?.length) {
      rule.properties.cwe = suggestion.cwe;
    }

    rules.push(rule);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    result[suggestionIndex] = {
      ...suggestions[suggestionIndex],
      ruleIndex,
      rule,
      level: severity,
      id: suggestionId,
      text: suggestion.message,
    };
    ruleIndex += 1;
  }
  return { tool: { driver: { ...output.driver, rules } }, suggestions: result };
};

function getResults(suggestions: ISarifSuggestions): Result[] {
  const output = [];

  for (const [, suggestion] of <[string, ISarifSuggestion][]>Object.entries(suggestions)) {
    let helpers: any[] = [];
    let result: Result = {
      ruleId: suggestion.id,
      ruleIndex: suggestion.ruleIndex,
      level: suggestion.level ? suggestion.level : 'none',
      message: {
        text: suggestion.text,
        markdown: suggestion.text,
        arguments: [''],
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: suggestion.file,
              uriBaseId: '%SRCROOT%',
            },
            region: {
              startLine: suggestion.rows[0],
              endLine: suggestion.rows[1],
              startColumn: suggestion.cols[0],
              endColumn: suggestion.cols[1],
            },
          },
        },
      ]
    };

    if (suggestion.fingerprints) {
      result.fingerprints = {};
      suggestion.fingerprints.forEach(fingerprinting => {
        (result.fingerprints as any)[`${fingerprinting.version}`] = fingerprinting.fingerprint;
      });
    }
    const codeThreadFlows = [];
    let i = 0;
    if (suggestion.markers && suggestion.markers.length >= 1) {
      for (const marker of suggestion.markers) {
        for (const position of marker.pos) {
          const helperIndex = helpers.findIndex(helper => helper.msg === marker.msg);
          if (helperIndex != -1) {
            helpers[helperIndex].index.push(i);
          } else {
            helpers.push({ index: [i], msg: marker.msg });
          }
          codeThreadFlows.push({
            location: {
              id: i,
              physicalLocation: {
                artifactLocation: {
                  uri: position.file.substring(1),
                  uriBaseId: '%SRCROOT%',
                },
                region: {
                  startLine: position.rows[0],
                  endLine: position.rows[1],
                  startColumn: position.cols[0],
                  endColumn: position.cols[1],
                },
              },
            },
          });
          i += 1;
        }
      }
    } else {
      codeThreadFlows.push({
        location: {
          id: 0,
          physicalLocation: {
            artifactLocation: {
              uri: suggestion.file,
              uriBaseId: '%SRCROOT%',
            },
            region: {
              startLine: suggestion.rows[0],
              endLine: suggestion.rows[1],
              startColumn: suggestion.cols[0],
              endColumn: suggestion.cols[1],
            },
          },
        },
      });
    }

    if (result.message.text) {
      const { message, argumentArray } = getArgumentsAndMessage(helpers, result.message.text);
      result.message.text = message;
      result.message.arguments = argumentArray;
    }

    const newResult = {
      ...result,
      codeFlows: [
        {
          threadFlows: [
            {
              locations: codeThreadFlows,
            },
          ],
        },
      ],
    };
    output.push(newResult);
  }
  return output;
};

//custom string splice implementation
export function stringSplice(str: string, index: number, count: number, add?: string) {
  // We cannot pass negative indexes directly to the 2nd slicing operation.
  if (index < 0) {
    index = str.length + index;
    if (index < 0) {
      index = 0;
    }
  }

  return str.slice(0, index) + (add || '') + str.slice(index + count);
}

export function getArgumentsAndMessage(
  helpers: { index: number[]; msg: number[] }[],
  message: string,
): { message: string; argumentArray: string[] } {
  let negativeOffset = 0;
  let argumentArray: string[] = [];
  let sortedArguements = helpers.sort((a: any, b: any) => a.msg[0] - b.msg[0]);
  sortedArguements.forEach((arg: any, index: number) => {
    let word = message.substring(arg.msg[0] + negativeOffset, arg.msg[1] + 1 + negativeOffset);
    argumentArray.push(`[${word}]${arg.index.map((i: number) => `(${i})`)}`);
    message = stringSplice(
      message,
      arg.msg[0] + negativeOffset,
      arg.msg[1] + 1 + negativeOffset - (arg.msg[0] + negativeOffset),
      `{${index}}`,
    );
    // (2 + index.toString().length) === number of inserted charecters, the 2 = {}
    negativeOffset += arg.msg[0] - (arg.msg[1] + 1) + (2 + index.toString().length);
  });

  return { message, argumentArray };
}

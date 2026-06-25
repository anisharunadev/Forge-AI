// allow-test-rule: source-text-is-the-product
// Agent .md files are the installed AI agents — the "Project skills" block IS the deployed
// instruction. Checking text content IS checking what runs in production.
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '..', 'agents');

function readAgent(name) {
  return fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8');
}

describe('project skills awareness', () => {
  const agentsRequiringSkills = [
    'forge-debugger',
    'forge-integration-checker',
    'forge-security-auditor',
    'forge-nyquist-auditor',
    'forge-codebase-mapper',
    'forge-roadmapper',
    'forge-eval-auditor',
    'forge-intel-updater',
    'forge-doc-writer',
  ];

  for (const agentName of agentsRequiringSkills) {
    test(`${agentName} has Project skills block`, () => {
      const content = readAgent(agentName);
      assert.ok(content.includes('Project skills'), `${agentName} missing Project skills block`);
    });

    test(`${agentName} does not load full AGENTS.md`, () => {
      const content = readAgent(agentName);
      assert.ok(
        !content.includes('Read AGENTS.md') && !content.includes('load AGENTS.md'),
        `${agentName} should not instruct loading full AGENTS.md`
      );
    });
  }

  test('forge-doc-writer has security note about doc_assignment user data', () => {
    const content = readAgent('forge-doc-writer');
    assert.ok(
      content.includes('doc_assignment') && content.includes('SECURITY'),
      'forge-doc-writer missing security note for doc_assignment block'
    );
  });
});

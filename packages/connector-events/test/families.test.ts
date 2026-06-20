/**
 * Family event catalogs — FORA-484 AC #2.
 */

import { describe, it, expect } from 'vitest';
import * as jira from '../src/families/jira.js';
import * as confluence from '../src/families/confluence.js';
import * as github from '../src/families/github.js';
import * as slack from '../src/families/slack.js';
import * as teams from '../src/families/teams.js';

describe('Jira family', () => {
  it('catalogs 6 events per Plan 3', () => {
    expect(jira.JIRA_EVENT_TYPES).toHaveLength(6);
  });
  it('JIRA_FAMILY is "jira"', () => {
    expect(jira.JIRA_FAMILY).toBe('jira');
  });
  it('isJiraEvent discriminates', () => {
    expect(jira.isJiraEvent('jira.issue.observed')).toBe(true);
    expect(jira.isJiraEvent('github.pr.opened')).toBe(false);
  });
  it('assertJiraEvent narrows the type', () => {
    expect(() => jira.assertJiraEvent('jira.transition.applied')).not.toThrow();
    expect(() => jira.assertJiraEvent('github.pr.opened')).toThrow();
  });
  it('maps ops to event types', () => {
    expect(jira.jiraEventFor('issue.list')).toBe('jira.search.executed');
    expect(jira.jiraEventFor('issue.transition')).toBe('jira.transition.applied');
    expect(jira.jiraEventFor('issue.link')).toBe('jira.issue.linked');
    expect(jira.jiraEventFor('project.health')).toBe('jira.health.checked');
  });
});

describe('Confluence family', () => {
  it('catalogs 5 events (page.published covers ADR + Deployment Plan)', () => {
    expect(confluence.CONFLUENCE_EVENT_TYPES).toHaveLength(5);
  });
  it('CONFLUENCE_FAMILY is "confluence"', () => {
    expect(confluence.CONFLUENCE_FAMILY).toBe('confluence');
  });
  it('page.publish → page.published', () => {
    expect(confluence.confluenceEventFor('page.publish')).toBe('confluence.page.published');
  });
});

describe('GitHub family', () => {
  it('catalogs 7 events per Plan 3', () => {
    expect(github.GITHUB_EVENT_TYPES).toHaveLength(7);
  });
  it('GITHUB_FAMILY is "github"', () => {
    expect(github.GITHUB_FAMILY).toBe('github');
  });
  it('pr.merge → pr.merged', () => {
    expect(github.githubEventFor('pr.merge')).toBe('github.pr.merged');
  });
  it('action_run.completed → action.run.completed', () => {
    expect(github.githubEventFor('action_run.completed')).toBe('github.action.run.completed');
  });
});

describe('Slack family', () => {
  it('catalogs 4 events per Plan 3', () => {
    expect(slack.SLACK_EVENT_TYPES).toHaveLength(4);
  });
  it('SLACK_FAMILY is "slack"', () => {
    expect(slack.SLACK_FAMILY).toBe('slack');
  });
});

describe('Teams family', () => {
  it('catalogs 4 events per Plan 3 (pre-skeleton MCP, registry only)', () => {
    expect(teams.TEAMS_EVENT_TYPES).toHaveLength(4);
  });
  it('TEAMS_FAMILY is "teams"', () => {
    expect(teams.TEAMS_FAMILY).toBe('teams');
  });
  it('transcript.receive → transcript.received (MVP-1 path)', () => {
    expect(teams.teamsEventFor('transcript.receive')).toBe('teams.transcript.received');
  });
});
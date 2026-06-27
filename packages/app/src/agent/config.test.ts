import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_URL, getAgentBaseUrl, getAgentEndpoint, RIVUS_AGENT_PATH } from './config';

describe('getAgentBaseUrl', () => {
	it('returns the configured EXPO_PUBLIC_AGENT_URL when set', () => {
		expect(getAgentBaseUrl({ EXPO_PUBLIC_AGENT_URL: 'https://agent.rivus.dev' })).toBe(
			'https://agent.rivus.dev',
		);
	});

	it('trims whitespace and trailing slashes', () => {
		expect(getAgentBaseUrl({ EXPO_PUBLIC_AGENT_URL: '  https://agent.rivus.dev/  ' })).toBe(
			'https://agent.rivus.dev',
		);
	});

	it('falls back to the default when the var is missing or blank', () => {
		expect(getAgentBaseUrl({})).toBe(DEFAULT_AGENT_URL);
		expect(getAgentBaseUrl({ EXPO_PUBLIC_AGENT_URL: '   ' })).toBe(DEFAULT_AGENT_URL);
	});

	it('reads from process.env by default without throwing', () => {
		expect(typeof getAgentBaseUrl()).toBe('string');
	});
});

describe('getAgentEndpoint', () => {
	it('appends the agent path to the base', () => {
		expect(getAgentEndpoint('https://agent.rivus.dev')).toBe(
			`https://agent.rivus.dev${RIVUS_AGENT_PATH}`,
		);
	});

	it('does not double up slashes when the base has a trailing slash', () => {
		expect(getAgentEndpoint('https://agent.rivus.dev/')).toBe(
			`https://agent.rivus.dev${RIVUS_AGENT_PATH}`,
		);
	});

	it('defaults to the resolved base url', () => {
		expect(getAgentEndpoint().endsWith(RIVUS_AGENT_PATH)).toBe(true);
	});
});

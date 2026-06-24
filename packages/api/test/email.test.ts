import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import {
	buildInviteAcceptUrl,
	type InviteEmail,
	NoopMailer,
	renderInviteEmail,
} from '../src/services/email';
import { createMailer, type FetchLike, ResendMailer } from '../src/services/resend-mailer';

const sampleInvite: InviteEmail = {
	to: 'invitee@example.com',
	inviteeName: 'Ada Lovelace',
	inviterName: 'Grace Hopper',
	accountName: 'Acme Co',
	role: 'manager',
	acceptUrl: 'https://app.rivus.ai/accept-invite?token=abc123',
};

describe('buildInviteAcceptUrl', () => {
	it('appends the encoded token to the app base URL', () => {
		expect(buildInviteAcceptUrl('https://app.rivus.ai', 'abc123')).toBe(
			'https://app.rivus.ai/accept-invite?token=abc123',
		);
	});

	it('strips a trailing slash from the base URL', () => {
		expect(buildInviteAcceptUrl('https://app.rivus.ai/', 'abc123')).toBe(
			'https://app.rivus.ai/accept-invite?token=abc123',
		);
	});

	it('url-encodes tokens with reserved characters', () => {
		expect(buildInviteAcceptUrl('https://app.rivus.ai', 'a b/c?d')).toBe(
			'https://app.rivus.ai/accept-invite?token=a%20b%2Fc%3Fd',
		);
	});
});

describe('renderInviteEmail', () => {
	it('includes the account, inviter, role label and link in both bodies', () => {
		const { subject, html, text } = renderInviteEmail(sampleInvite);

		expect(subject).toBe("You're invited to join Acme Co on Rivus");
		for (const body of [html, text]) {
			expect(body).toContain('Ada Lovelace');
			expect(body).toContain('Grace Hopper');
			expect(body).toContain('Acme Co');
			expect(body).toContain('Manager');
			expect(body).toContain('https://app.rivus.ai/accept-invite?token=abc123');
		}
	});

	it('labels the team_member role in human-readable form', () => {
		const { html } = renderInviteEmail({ ...sampleInvite, role: 'team_member' });
		expect(html).toContain('Team Member');
	});

	it('escapes HTML in user-controlled names to prevent injection', () => {
		const { html, text } = renderInviteEmail({
			...sampleInvite,
			accountName: '<script>alert(1)</script>',
			inviterName: 'Mallory & "Co"',
		});

		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).toContain('Mallory &amp; &quot;Co&quot;');
		// The plain-text body is not HTML, so it carries the raw characters.
		expect(text).toContain('<script>alert(1)</script>');
	});
});

describe('NoopMailer', () => {
	it('resolves without doing anything', async () => {
		await expect(new NoopMailer().sendInviteEmail(sampleInvite)).resolves.toBeUndefined();
	});
});

describe('ResendMailer', () => {
	it('POSTs a rendered email to the Resend API with auth and from header', async () => {
		const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => '{"id":"email_1"}',
		});
		const mailer = new ResendMailer({
			apiKey: 're_test_key',
			from: 'Rivus <hello@rivus.ai>',
			fetchImpl,
		});

		await mailer.sendInviteEmail(sampleInvite);

		expect(fetchImpl).toHaveBeenCalledOnce();
		const [url, init] = fetchImpl.mock.calls[0] as [
			string,
			{ method: string; headers: Record<string, string>; body: string },
		];
		expect(url).toBe('https://api.resend.com/emails');
		expect(init.method).toBe('POST');
		expect(init.headers.authorization).toBe('Bearer re_test_key');
		expect(init.headers['content-type']).toBe('application/json');
		const sent = JSON.parse(init.body);
		expect(sent).toMatchObject({
			from: 'Rivus <hello@rivus.ai>',
			to: 'invitee@example.com',
			subject: "You're invited to join Acme Co on Rivus",
		});
		expect(sent.html).toContain('Accept invitation');
		expect(sent.text).toContain('Acme Co');
	});

	it('throws with the response detail when Resend rejects the email', async () => {
		const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
			ok: false,
			status: 422,
			text: async () => '{"message":"domain not verified"}',
		});
		const mailer = new ResendMailer({ apiKey: 're_test_key', from: 'x@y.z', fetchImpl });

		await expect(mailer.sendInviteEmail(sampleInvite)).rejects.toThrow(/422.*domain not verified/);
	});
});

describe('createMailer', () => {
	const baseConfig = loadConfig({
		NODE_ENV: 'test',
		JWT_SECRET: 'test-secret-value-1234',
	} as NodeJS.ProcessEnv);

	it('returns a no-op mailer when no API key is configured', () => {
		expect(createMailer(baseConfig)).toBeInstanceOf(NoopMailer);
	});

	it('returns a Resend mailer when an API key is present', () => {
		expect(createMailer({ ...baseConfig, RESEND_API_KEY: 're_test_key' })).toBeInstanceOf(
			ResendMailer,
		);
	});
});

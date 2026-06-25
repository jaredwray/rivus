import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addMember, authHeader, buildTestApp, signupOwner } from './helpers';

const STAFF_EMAIL = 'ops@rivus.ai';

describe('admin companies — list', () => {
	let app: FastifyInstance;
	let staffToken: string;

	beforeEach(async () => {
		app = await buildTestApp();
		// A staff member who also owns their own company ("Rivus HQ").
		staffToken = (await signupOwner(app, { email: STAFF_EMAIL, businessName: 'Rivus HQ' })).token;
		await signupOwner(app, { businessName: 'Acme Plumbing' });
		await signupOwner(app, { businessName: 'Beacon Electric' });
	});

	afterEach(async () => {
		await app.close();
	});

	function listCompanies(token: string, query = '') {
		return app.inject({
			method: 'GET',
			url: `/v1/admin/companies${query}`,
			headers: authHeader(token),
		});
	}

	it('lists every active company for staff, sorted by name', async () => {
		const response = await listCompanies(staffToken);

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.meta.total).toBe(3);
		expect(body.data.map((account: { name: string }) => account.name)).toEqual([
			'Acme Plumbing',
			'Beacon Electric',
			'Rivus HQ',
		]);
	});

	it('filters companies by a case-insensitive name search', async () => {
		const response = await listCompanies(staffToken, '?search=acme');

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.meta.total).toBe(1);
		expect(body.data[0].name).toBe('Acme Plumbing');
	});

	it('matches the slug as well as the name', async () => {
		// The slug "beacon-electric" carries a hyphen the display name does not, so a
		// hyphenated search can only match via the slug.
		const response = await listCompanies(staffToken, '?search=beacon-electric');

		expect(response.statusCode).toBe(200);
		expect(response.json().data.map((a: { name: string }) => a.name)).toEqual(['Beacon Electric']);
	});

	it('returns an empty page when nothing matches', async () => {
		const response = await listCompanies(staffToken, '?search=nonexistent');

		expect(response.statusCode).toBe(200);
		expect(response.json().data).toHaveLength(0);
		expect(response.json().meta.total).toBe(0);
	});

	it('paginates the company list', async () => {
		const response = await listCompanies(staffToken, '?page=1&pageSize=2');

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.data).toHaveLength(2);
		expect(body.meta).toMatchObject({
			page: 1,
			pageSize: 2,
			total: 3,
			totalPages: 2,
			hasNextPage: true,
			hasPreviousPage: false,
		});
	});

	it('rejects a non-staff user with 403', async () => {
		const ownerToken = (await signupOwner(app)).token;
		const response = await listCompanies(ownerToken);
		expect(response.statusCode).toBe(403);
	});

	it('rejects an unauthenticated request with 401', async () => {
		const response = await app.inject({ method: 'GET', url: '/v1/admin/companies' });
		expect(response.statusCode).toBe(401);
	});

	it('lets staff who are only a member of their own company still list every company', async () => {
		// A fresh app where the staff user joined a company as a plain member (not an
		// owner). Staff status is by email, so it grants access regardless of role.
		const fresh = await buildTestApp();
		const owner = await signupOwner(fresh, { businessName: 'Host Co' });
		const member = await addMember(fresh, owner.token, 'member', STAFF_EMAIL);

		const response = await fresh.inject({
			method: 'GET',
			url: '/v1/admin/companies',
			headers: authHeader(member.token),
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().meta.total).toBe(1);
		await fresh.close();
	});
});

describe('admin companies — switch', () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildTestApp();
	});

	afterEach(async () => {
		await app.close();
	});

	function switchTo(token: string, accountId: string) {
		return app.inject({
			method: 'POST',
			url: `/v1/admin/companies/${accountId}/switch`,
			headers: authHeader(token),
		});
	}

	it('lets staff switch into another company with full owner access', async () => {
		const staff = await signupOwner(app, { email: STAFF_EMAIL, businessName: 'Rivus HQ' });
		const target = await signupOwner(app, { businessName: 'Target Co' });
		// Seed an item the target company owns, so we can prove staff can read its data.
		const created = await app.inject({
			method: 'POST',
			url: '/v1/items',
			headers: authHeader(target.token),
			payload: { name: 'Target widget' },
		});
		const itemId = created.json().id;

		const response = await switchTo(staff.token, target.account.id);

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.account.id).toBe(target.account.id);
		expect(body.account.name).toBe('Target Co');
		// No membership in the target company → staff operate it as owner.
		expect(body.role).toBe('owner');
		expect(body.token).toBeTypeOf('string');

		// The re-issued session really is scoped to the target company.
		const me = await app.inject({
			method: 'GET',
			url: '/v1/auth/me',
			headers: authHeader(body.token),
		});
		expect(me.json().account.id).toBe(target.account.id);

		// And staff can now read the target company's data.
		const item = await app.inject({
			method: 'GET',
			url: `/v1/items/${itemId}`,
			headers: authHeader(body.token),
		});
		expect(item.statusCode).toBe(200);
		expect(item.json().name).toBe('Target widget');
	});

	it('sets a fresh session cookie scoped to the new company', async () => {
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		const target = await signupOwner(app, { businessName: 'Cookie Co' });

		const response = await switchTo(staff.token, target.account.id);
		const setCookie = response.headers['set-cookie'];
		const header = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
		expect(header).toContain('rivus_session=');
		expect(header).toContain('HttpOnly');
	});

	it('preserves the real membership role when staff switch back to their own company', async () => {
		// The staff user is only a *member* of "Host Co" (their single membership).
		const owner = await signupOwner(app, { businessName: 'Host Co' });
		const member = await addMember(app, owner.token, 'member', STAFF_EMAIL);
		const other = await signupOwner(app, { businessName: 'Other Co' });

		// Into a company with no membership → owner access.
		const intoOther = await switchTo(member.token, other.account.id);
		expect(intoOther.json().role).toBe('owner');

		// Back into their own company → their actual (member) role is kept.
		const backHome = await switchTo(intoOther.json().token, owner.account.id);
		expect(backHome.statusCode).toBe(200);
		expect(backHome.json().role).toBe('member');
	});

	it('returns 404 for an unknown company id', async () => {
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		const response = await switchTo(staff.token, 'does-not-exist');
		expect(response.statusCode).toBe(404);
	});

	it('returns 404 when switching into a canceled company', async () => {
		const staff = await signupOwner(app, { email: STAFF_EMAIL });
		const target = await signupOwner(app, { businessName: 'Gone Co' });
		await app.inject({
			method: 'POST',
			url: '/v1/account/cancel',
			headers: authHeader(target.token),
		});

		const response = await switchTo(staff.token, target.account.id);
		expect(response.statusCode).toBe(404);
	});

	it('rejects a non-staff user with 403', async () => {
		const owner = await signupOwner(app, { businessName: 'A Co' });
		const target = await signupOwner(app, { businessName: 'B Co' });
		const response = await switchTo(owner.token, target.account.id);
		expect(response.statusCode).toBe(403);
	});

	it('rejects an unauthenticated request with 401', async () => {
		const target = await signupOwner(app, { businessName: 'C Co' });
		const response = await app.inject({
			method: 'POST',
			url: `/v1/admin/companies/${target.account.id}/switch`,
		});
		expect(response.statusCode).toBe(401);
	});
});

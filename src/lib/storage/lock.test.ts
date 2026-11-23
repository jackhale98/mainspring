// SPDX-License-Identifier: GPL-2.0-or-later
// The owner lock (phase-4.md 7.1, 8.1 #7, 13.1): one tab per plan, a second owner refused, "Open
// here instead" handing over after the owner stored its text, a frozen owner losing it by force,
// and no Web Locks. Two "tabs" are two `createAcquire`s on one fake lock manager and Node's own
// BroadcastChannel (messages between instances, as between tabs).
import { afterEach, describe, expect, it } from 'vitest';
import { createAcquire, type HeldLock } from './lock';
import { fakeLocks } from './testing/fake-locks';

const settled = (p: Promise<unknown>): Promise<boolean> =>
	Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 30))]);

const open: HeldLock[] = [];
afterEach(() => {
	for (const l of open.splice(0)) l.release();
});

async function take(
	acquire: ReturnType<typeof createAcquire>,
	id: string,
	steal = false,
): Promise<HeldLock> {
	const l = await acquire(id, steal ? { steal } : undefined);
	if (l === 'held-elsewhere') throw new Error('held elsewhere');
	open.push(l);
	return l;
}

describe('acquire', () => {
	it('gives one tab the plan; a second is told it is held elsewhere until the first lets go', async () => {
		const locks = fakeLocks();
		const tabA = createAcquire({ locks });
		const tabB = createAcquire({ locks });
		const a = await take(tabA, 'p1');
		expect(await tabB('p1')).toBe('held-elsewhere');
		// Another plan is free.
		await take(tabB, 'p2');
		a.release();
		a.release();
		// Web Locks let go once the holder's promise settles, a task later.
		await new Promise((r) => setTimeout(r, 0));
		await take(tabB, 'p1');
		// A release is not a loss.
		expect(await settled(a.lost)).toBe(false);
	});

	it('hands the plan over on "Open here instead" once the owner has stored its text', async () => {
		const locks = fakeLocks();
		const tabA = createAcquire({ locks });
		const tabB = createAcquire({ locks });
		const a = await take(tabA, 'p1');
		const order: string[] = [];
		let stored!: () => void;
		a.onAsked(() => {
			order.push('asked');
			return new Promise<void>((r) => (stored = r));
		});
		void a.lost.then(() => order.push('lost'));
		const b = take(tabB, 'p1', true);
		await expect.poll(() => order).toEqual(['asked']);
		// B waits while A stores what its autosave holds.
		expect(await settled(b)).toBe(false);
		stored();
		const lock = await b;
		expect(order).toEqual(['asked', 'lost']);
		expect(locks.isHeld('mainspring.plan.p1')).toBe(true);
		expect(await settled(lock.lost)).toBe(false);
		// A cannot have it back without asking in turn.
		expect(await tabA('p1')).toBe('held-elsewhere');
	});

	it('takes the plan by force from an owner that does not answer in time', async () => {
		const locks = fakeLocks();
		// A frozen tab: it hears nothing.
		const tabA = createAcquire({ locks, channel: () => null });
		const tabB = createAcquire({ locks, handoverMs: 20 });
		const a = await take(tabA, 'p1');
		const b = await take(tabB, 'p1', true);
		await a.lost;
		expect(await settled(b.lost)).toBe(false);
	});

	it("still hands over when the owner's hook never settles, after the handover time", async () => {
		const locks = fakeLocks();
		const tabA = createAcquire({ locks, handoverMs: 20 });
		const tabB = createAcquire({ locks, handoverMs: 1000 });
		const a = await take(tabA, 'p1');
		a.onAsked(() => new Promise(() => undefined));
		await take(tabB, 'p1', true);
		await a.lost;
	});

	it('grants "Open here instead" at once when nobody holds the plan', async () => {
		const acquire = createAcquire({ locks: fakeLocks(), handoverMs: 5000 });
		expect(await settled(take(acquire, 'p1', true))).toBe(true);
	});

	it('is granted and never lost without Web Locks', async () => {
		const acquire = createAcquire({ locks: null });
		const a = await take(acquire, 'p1');
		const b = await take(acquire, 'p1');
		expect(await settled(a.lost)).toBe(false);
		expect(await settled(b.lost)).toBe(false);
	});
});

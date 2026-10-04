import { expect, it } from 'vitest';
import * as pushRepo from '@/lib/db/repos/push-subscriptions';
import { describeDb } from './database';

describeDb('push subscriptions', () => {
  const device = { endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: 'k'.repeat(87), auth: 'a'.repeat(22) };

  it('saves a device once, updates its keys when it subscribes again, and removes it', async () => {
    await pushRepo.save({ ...device, userAgent: 'Android' });
    await pushRepo.save({ ...device, auth: 'b'.repeat(22), userAgent: 'Android 2' });
    expect(await pushRepo.size()).toBe(1);
    expect(await pushRepo.list()).toEqual([{ ...device, auth: 'b'.repeat(22) }]);
    expect(await pushRepo.get(device.endpoint)).toEqual({ ...device, auth: 'b'.repeat(22) });
    await pushRepo.remove(device.endpoint);
    expect(await pushRepo.get(device.endpoint)).toBeNull();
    expect(await pushRepo.size()).toBe(0);
  });
});

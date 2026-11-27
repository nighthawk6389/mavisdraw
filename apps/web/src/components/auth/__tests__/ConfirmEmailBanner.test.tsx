import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const config = vi.hoisted(() => ({ mail: true }));
vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  apiGetServerConfig: vi.fn(async () => ({ mail: config.mail })),
}));

// React's act() environment for a plain root
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function renderBanner(emailVerified = false) {
  vi.resetModules(); // the "does it send email" answer is cached per page load
  const { useAuthStore } = await import('../../../stores/authStore');
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'ana@example.com',
      name: 'Ana',
      avatarUrl: null,
      emailVerified,
      createdAt: '',
      updatedAt: '',
    },
  });
  const { default: Banner } = await import('../ConfirmEmailBanner');
  await act(async () => root.render(<Banner />));
  await act(async () => {});
  return container.textContent ?? '';
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('confirm-your-email banner', () => {
  it('says a link was sent, and offers another, when the server sends email', async () => {
    config.mail = true;
    const text = await renderBanner();
    expect(text).toContain('we sent a link to ana@example.com');
    expect(container.querySelector('button')?.textContent).toBe('Send it again');
  });

  it('on a server without email, points to invite links instead of promising one', async () => {
    config.mail = false;
    const text = await renderBanner();
    expect(text).toContain('this server doesn’t send email');
    expect(text).toContain('ask them for the invite link');
    expect(text).not.toContain('we sent');
    expect(container.querySelector('button')).toBeNull();
  });

  it('is gone once the address is confirmed', async () => {
    expect(await renderBanner(true)).toBe('');
  });
});

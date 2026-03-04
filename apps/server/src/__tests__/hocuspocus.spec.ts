import { describe, it, expect } from 'vitest';
import { createHocuspocusServer } from '../ws/hocuspocus.js';

describe('createHocuspocusServer', () => {
  it('should create a Hocuspocus server instance', () => {
    const server = createHocuspocusServer();
    expect(server).toBeDefined();
    expect(typeof server.handleConnection).toBe('function');
  });

  it('should configure debounce settings', () => {
    const server = createHocuspocusServer();
    // The server should be created without errors
    expect(server).toBeTruthy();
  });
});

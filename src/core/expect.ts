export function expect(received: any) {
  return {
    toBe(expected: any) {
      if (received !== expected) {
        throw new Error(`Expected ${received} to be ${expected}`);
      }
    },

    toContain(value: any) {
      if (!received.includes(value)) {
        throw new Error(`Expected ${received} to contain ${value}`);
      }
    }
  };
}
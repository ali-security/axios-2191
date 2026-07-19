import assert from 'assert';
import shouldBypassProxy from '../../../lib/helpers/shouldBypassProxy.js';

const originalNoProxy = process.env.no_proxy;
const originalNOProxy = process.env.NO_PROXY;

const setNoProxy = (value) => {
  process.env.no_proxy = value;
  process.env.NO_PROXY = value;
};

afterEach(() => {
  if (originalNoProxy === undefined) {
    delete process.env.no_proxy;
  } else {
    process.env.no_proxy = originalNoProxy;
  }

  if (originalNOProxy === undefined) {
    delete process.env.NO_PROXY;
  } else {
    process.env.NO_PROXY = originalNOProxy;
  }
});

describe('helpers::shouldBypassProxy', function () {
  it('should bypass proxy for localhost with a trailing dot', function () {
    setNoProxy('localhost,127.0.0.1,::1');
    assert.strictEqual(shouldBypassProxy('http://localhost.:8080/'), true);
  });

  it('should bypass proxy for bracketed ipv6 loopback', function () {
    setNoProxy('localhost,127.0.0.1,::1');
    assert.strictEqual(shouldBypassProxy('http://[::1]:8080/'), true);
  });

  it('should support bracketed ipv6 entries in no_proxy', function () {
    setNoProxy('[::1]');
    assert.strictEqual(shouldBypassProxy('http://[::1]:8080/'), true);
  });

  it('should match wildcard and explicit ports', function () {
    setNoProxy('*.example.com,localhost:8080');
    assert.strictEqual(shouldBypassProxy('http://api.example.com/'), true);
    assert.strictEqual(shouldBypassProxy('http://localhost:8080/'), true);
    assert.strictEqual(shouldBypassProxy('http://localhost:8081/'), false);
  });

  it('should return false for invalid URLs', function () {
    setNoProxy('localhost');
    assert.strictEqual(shouldBypassProxy('not a url'), false);
  });

  it('should return false when no_proxy is empty', function () {
    setNoProxy('');
    assert.strictEqual(shouldBypassProxy('http://localhost:8080/'), false);
  });

  it('should bypass everything when no_proxy is *', function () {
    setNoProxy('*');
    assert.strictEqual(shouldBypassProxy('http://anything.example.com/'), true);
  });
});

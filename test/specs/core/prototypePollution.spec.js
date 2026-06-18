var utils = require('../../../lib/utils');
var mergeConfig = require('../../../lib/core/mergeConfig');

describe('Prototype Pollution Protection', function() {
  function clearPollution() {
    delete Object.prototype.polluted;
    delete Object.prototype.transport;
    delete Object.prototype.transformRequest;
    delete Object.prototype.transformResponse;
    delete Object.prototype.formSerializer;
    delete Object.prototype.env;
    delete Object.prototype.parseReviver;
    delete Object.prototype.auth;
    delete Object.prototype.username;
    delete Object.prototype.password;
    delete Object.prototype.common;
    delete Object.prototype.get;
    delete Object.prototype.set;
  }

  beforeEach(clearPollution);
  afterEach(clearPollution);

  describe('utils.merge', function() {
    it('should filter __proto__ key at top level', function() {
      var result = utils.merge(
        {},
        { __proto__: { polluted: 'yes' }, safe: 'value' }
      );

      expect(Object.prototype.polluted).toEqual(undefined);
      expect(result.safe).toEqual('value');
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toEqual(false);
    });

    it('should filter constructor key at top level', function() {
      var result = utils.merge(
        {},
        { constructor: { polluted: 'yes' }, safe: 'value' }
      );

      expect(result.safe).toEqual('value');
      expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toEqual(false);
    });

    it('should filter prototype key at top level', function() {
      var result = utils.merge(
        {},
        { prototype: { polluted: 'yes' }, safe: 'value' }
      );

      expect(result.safe).toEqual('value');
      expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toEqual(false);
    });

    it('should filter __proto__ key in nested objects', function() {
      var result = utils.merge(
        {},
        {
          headers: {
            __proto__: { polluted: 'nested' },
            'Content-Type': 'application/json'
          }
        }
      );

      expect(Object.prototype.polluted).toEqual(undefined);
      expect(result.headers['Content-Type']).toEqual('application/json');
      expect(Object.prototype.hasOwnProperty.call(result.headers, '__proto__')).toEqual(false);
    });

    it('should filter constructor key in nested objects', function() {
      var result = utils.merge(
        {},
        {
          headers: {
            constructor: { prototype: { polluted: 'nested' } },
            'Content-Type': 'application/json'
          }
        }
      );

      expect(Object.prototype.polluted).toEqual(undefined);
      expect(result.headers['Content-Type']).toEqual('application/json');
      expect(Object.prototype.hasOwnProperty.call(result.headers, 'constructor')).toEqual(false);
    });

    it('should filter prototype key in nested objects', function() {
      var result = utils.merge(
        {},
        {
          headers: {
            prototype: { polluted: 'nested' },
            'Content-Type': 'application/json'
          }
        }
      );

      expect(result.headers['Content-Type']).toEqual('application/json');
      expect(Object.prototype.hasOwnProperty.call(result.headers, 'prototype')).toEqual(false);
    });

    it('should filter dangerous keys in deeply nested objects', function() {
      var result = utils.merge(
        {},
        {
          level1: {
            level2: {
              __proto__: { polluted: 'deep' },
              prototype: { polluted: 'deep' },
              safe: 'value'
            }
          }
        }
      );

      expect(Object.prototype.polluted).toEqual(undefined);
      expect(result.level1.level2.safe).toEqual('value');
      expect(Object.prototype.hasOwnProperty.call(result.level1.level2, '__proto__')).toEqual(false);
    });

    it('should still merge regular properties correctly', function() {
      var result = utils.merge({ a: 1, b: { c: 2 } }, { b: { d: 3 }, e: 4 });

      expect(result.a).toEqual(1);
      expect(result.b.c).toEqual(2);
      expect(result.b.d).toEqual(3);
      expect(result.e).toEqual(4);
    });

    it('should handle JSON.parse payloads safely', function() {
      var malicious = JSON.parse('{"__proto__": {"polluted": "yes"}}');
      var result = utils.merge({}, malicious);

      expect(Object.prototype.polluted).toEqual(undefined);
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toEqual(false);
    });

    it('should handle nested JSON.parse payloads safely', function() {
      var malicious = JSON.parse(
        '{"headers": {"constructor": {"prototype": {"polluted": "yes"}}}}'
      );
      var result = utils.merge({}, malicious);

      expect(Object.prototype.polluted).toEqual(undefined);
      expect(Object.prototype.hasOwnProperty.call(result.headers, 'constructor')).toEqual(false);
    });

    it('should create nested plain objects that do not inherit proxy credentials', function() {
      Object.prototype.auth = 'polluted';
      Object.prototype.username = 'polluted-user';
      Object.prototype.password = 'polluted-pass';

      var result = utils.merge({}, {
        proxy: {
          host: 'localhost',
          nested: {
            enabled: true
          }
        }
      });

      expect(Object.getPrototypeOf(result.proxy)).toEqual(null);
      expect(Object.getPrototypeOf(result.proxy.nested)).toEqual(null);
      expect(result.proxy.auth).toEqual(undefined);
      expect(result.proxy.username).toEqual(undefined);
      expect(result.proxy.password).toEqual(undefined);
      expect(result.proxy.nested.auth).toEqual(undefined);
    });

    it('should not copy polluted inherited header buckets into nested headers', function() {
      Object.prototype.common = { 'x-polluted-common': 'yes' };
      Object.prototype.get = { 'x-polluted-get': 'yes' };

      var result = utils.merge({}, {
        headers: {
          common: {
            Accept: 'application/json'
          },
          get: {
            'x-own-get': 'yes'
          }
        }
      });

      expect(result.headers.common.Accept).toEqual('application/json');
      expect(result.headers.get['x-own-get']).toEqual('yes');
      expect(result.headers.common['x-polluted-common']).toEqual(undefined);
      expect(result.headers.get['x-polluted-get']).toEqual(undefined);
      expect(Object.getPrototypeOf(result.headers)).toEqual(null);
      expect(Object.getPrototypeOf(result.headers.common)).toEqual(null);
      expect(Object.getPrototypeOf(result.headers.get)).toEqual(null);
    });
  });

  describe('mergeConfig', function() {
    it('should filter dangerous keys at top level', function() {
      var result = mergeConfig(
        {},
        {
          __proto__: { polluted: 'yes' },
          constructor: { polluted: 'yes' },
          prototype: { polluted: 'yes' },
          url: '/api/test'
        }
      );

      expect(Object.prototype.polluted).toEqual(undefined);
      expect(result.url).toEqual('/api/test');
      var hasOwn = Object.prototype.hasOwnProperty;
      expect(hasOwn.call(result, '__proto__')).toEqual(false);
      expect(hasOwn.call(result, 'constructor')).toEqual(false);
      expect(hasOwn.call(result, 'prototype')).toEqual(false);
    });

    it('should filter dangerous keys in headers', function() {
      var result = mergeConfig(
        {},
        {
          headers: {
            __proto__: { polluted: 'yes' },
            'Content-Type': 'application/json'
          }
        }
      );

      expect(Object.prototype.polluted).toEqual(undefined);
      expect(result.headers['Content-Type']).toEqual('application/json');
      expect(Object.prototype.hasOwnProperty.call(result.headers, '__proto__')).toEqual(false);
    });

    it('should filter dangerous keys in custom config properties', function() {
      var result = mergeConfig(
        {},
        {
          customProp: {
            __proto__: { polluted: 'yes' },
            safe: 'value'
          }
        }
      );

      expect(Object.prototype.polluted).toEqual(undefined);
      expect(result.customProp.safe).toEqual('value');
      expect(Object.prototype.hasOwnProperty.call(result.customProp, '__proto__')).toEqual(false);
    });

    it('should create nested plain config objects that do not inherit proxy credentials', function() {
      Object.prototype.auth = 'polluted';
      Object.prototype.username = 'polluted-user';
      Object.prototype.password = 'polluted-pass';

      var result = mergeConfig({}, {
        proxy: {
          host: 'localhost',
          port: 4000
        }
      });

      expect(Object.getPrototypeOf(result.proxy)).toEqual(null);
      expect(result.proxy.auth).toEqual(undefined);
      expect(result.proxy.username).toEqual(undefined);
      expect(result.proxy.password).toEqual(undefined);
    });

    it("should not inherit transport from Object.prototype", function () {
      var polluted = { request: function () {} };
      Object.prototype.transport = polluted;
      var result = mergeConfig({}, { url: "/a" });
      expect(
        Object.prototype.hasOwnProperty.call(result, "transport")
      ).toEqual(false);
      // Reading via the prototype chain must not surface the polluted value.
      expect(result.transport).toBe(undefined);
      expect(result.transport).not.toBe(polluted);
    });

    it("should not inherit transformRequest from Object.prototype", function () {
      var polluted = function () { return "hijacked"; };
      Object.prototype.transformRequest = polluted;
      var result = mergeConfig({}, { url: "/a" });
      expect(
        Object.prototype.hasOwnProperty.call(result, "transformRequest")
      ).toEqual(false);
      expect(result.transformRequest).toBe(undefined);
      expect(result.transformRequest).not.toBe(polluted);
    });

    it("should not inherit transformResponse from Object.prototype", function () {
      var polluted = function () { return "hijacked"; };
      Object.prototype.transformResponse = polluted;
      var result = mergeConfig({}, { url: "/a" });
      expect(
        Object.prototype.hasOwnProperty.call(result, "transformResponse")
      ).toEqual(false);
      expect(result.transformResponse).toBe(undefined);
      expect(result.transformResponse).not.toBe(polluted);
    });

    it("should not inherit adapter from Object.prototype", function () {
      var polluted = function () { return "hijacked"; };
      Object.prototype.adapter = polluted;
      try {
        var result = mergeConfig({}, { url: "/a" });
        expect(
          Object.prototype.hasOwnProperty.call(result, "adapter")
        ).toEqual(false);
        expect(result.adapter).toBe(undefined);
        expect(result.adapter).not.toBe(polluted);
      } finally {
        delete Object.prototype.adapter;
      }
    });

    it("should not inherit arbitrary keys from Object.prototype", function () {
      Object.prototype.polluted = "yes";
      var result = mergeConfig({}, { url: "/a" });
      expect(
        Object.prototype.hasOwnProperty.call(result, "polluted")
      ).toEqual(false);
      expect(result.polluted).toBe(undefined);
    });

    it('should still merge configs correctly', function() {
      var config1 = {
        baseURL: 'https://api.example.com',
        timeout: 1000,
        headers: {
          common: {
            Accept: 'application/json'
          }
        }
      };

      var config2 = {
        url: '/users',
        timeout: 5000,
        headers: {
          common: {
            'Content-Type': 'application/json'
          }
        }
      };

      var result = mergeConfig(config1, config2);

      expect(result.baseURL).toEqual('https://api.example.com');
      expect(result.url).toEqual('/users');
      expect(result.timeout).toEqual(5000);
      expect(result.headers.common.Accept).toEqual('application/json');
      expect(result.headers.common['Content-Type']).toEqual('application/json');
    });

    it('should not throw when Object.prototype get and set are polluted', function() {
      Object.prototype.get = function () {};
      Object.prototype.set = function () {};

      expect(function() {
        mergeConfig({}, {
          url: '/users',
          headers: {
            common: {
              Accept: 'application/json'
            }
          }
        });
      }).not.toThrow();
    });

    it('should prepare request headers without descriptor errors when get and set are polluted', function(done) {
      var axios = require('../../../index');

      Object.prototype.get = function () {};
      Object.prototype.set = function () {};

      var instance = axios.create({
        adapter: function adapter(config) {
          expect(config.headers.Accept).toEqual('application/json');
          return Promise.resolve({
            data: null,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: config
          });
        },
        headers: {
          common: {
            Accept: 'application/json'
          }
        }
      });

      instance.get('/users').then(function() {
        done();
      }).catch(done);
    });
  });
});

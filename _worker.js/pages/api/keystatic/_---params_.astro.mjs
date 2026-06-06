globalThis.process ??= {}; globalThis.process.env ??= {};
export { renderers } from '../../../renderers.mjs';

var dist$1 = {};

Object.defineProperty(dist$1, "__esModule", { value: true });
dist$1.parseCookie = parseCookie;
var parse$1 = dist$1.parse = parseCookie;
dist$1.stringifyCookie = stringifyCookie;
dist$1.stringifySetCookie = stringifySetCookie;
var serialize = dist$1.serialize = stringifySetCookie;
dist$1.parseSetCookie = parseSetCookie;
dist$1.stringifySetCookie = stringifySetCookie;
serialize = dist$1.serialize = stringifySetCookie;
/**
 * RegExp to match cookie-name in RFC 6265 sec 4.1.1
 * This refers out to the obsoleted definition of token in RFC 2616 sec 2.2
 * which has been replaced by the token definition in RFC 7230 appendix B.
 *
 * cookie-name       = token
 * token             = 1*tchar
 * tchar             = "!" / "#" / "$" / "%" / "&" / "'" /
 *                     "*" / "+" / "-" / "." / "^" / "_" /
 *                     "`" / "|" / "~" / DIGIT / ALPHA
 *
 * Note: Allowing more characters - https://github.com/jshttp/cookie/issues/191
 * Allow same range as cookie value, except `=`, which delimits end of name.
 */
const cookieNameRegExp = /^[\u0021-\u003A\u003C\u003E-\u007E]+$/;
/**
 * RegExp to match cookie-value in RFC 6265 sec 4.1.1
 *
 * cookie-value      = *cookie-octet / ( DQUOTE *cookie-octet DQUOTE )
 * cookie-octet      = %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E
 *                     ; US-ASCII characters excluding CTLs,
 *                     ; whitespace DQUOTE, comma, semicolon,
 *                     ; and backslash
 *
 * Allowing more characters: https://github.com/jshttp/cookie/issues/191
 * Comma, backslash, and DQUOTE are not part of the parsing algorithm.
 */
const cookieValueRegExp = /^[\u0021-\u003A\u003C-\u007E]*$/;
/**
 * RegExp to match domain-value in RFC 6265 sec 4.1.1
 *
 * domain-value      = <subdomain>
 *                     ; defined in [RFC1034], Section 3.5, as
 *                     ; enhanced by [RFC1123], Section 2.1
 * <subdomain>       = <label> | <subdomain> "." <label>
 * <label>           = <let-dig> [ [ <ldh-str> ] <let-dig> ]
 *                     Labels must be 63 characters or less.
 *                     'let-dig' not 'letter' in the first char, per RFC1123
 * <ldh-str>         = <let-dig-hyp> | <let-dig-hyp> <ldh-str>
 * <let-dig-hyp>     = <let-dig> | "-"
 * <let-dig>         = <letter> | <digit>
 * <letter>          = any one of the 52 alphabetic characters A through Z in
 *                     upper case and a through z in lower case
 * <digit>           = any one of the ten digits 0 through 9
 *
 * Keep support for leading dot: https://github.com/jshttp/cookie/issues/173
 *
 * > (Note that a leading %x2E ("."), if present, is ignored even though that
 * character is not permitted, but a trailing %x2E ("."), if present, will
 * cause the user agent to ignore the attribute.)
 */
const domainValueRegExp = /^([.]?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
/**
 * RegExp to match path-value in RFC 6265 sec 4.1.1
 *
 * path-value        = <any CHAR except CTLs or ";">
 * CHAR              = %x01-7F
 *                     ; defined in RFC 5234 appendix B.1
 */
const pathValueRegExp = /^[\u0020-\u003A\u003D-\u007E]*$/;
/**
 * RegExp to match max-age-value in RFC 6265 sec 5.6.2
 */
const maxAgeRegExp = /^-?\d+$/;
const __toString = Object.prototype.toString;
const NullObject = /* @__PURE__ */ (() => {
    const C = function () { };
    C.prototype = Object.create(null);
    return C;
})();
/**
 * Parse a `Cookie` header.
 *
 * Parse the given cookie header string into an object
 * The object has the various cookies as keys(names) => values
 */
function parseCookie(str, options) {
    const obj = new NullObject();
    const len = str.length;
    // RFC 6265 sec 4.1.1, RFC 2616 2.2 defines a cookie name consists of one char minimum, plus '='.
    if (len < 2)
        return obj;
    const dec = options?.decode || decode;
    let index = 0;
    do {
        const eqIdx = eqIndex(str, index, len);
        if (eqIdx === -1)
            break; // No more cookie pairs.
        const endIdx = endIndex(str, index, len);
        if (eqIdx > endIdx) {
            // backtrack on prior semicolon
            index = str.lastIndexOf(";", eqIdx - 1) + 1;
            continue;
        }
        const key = valueSlice(str, index, eqIdx);
        // only assign once
        if (obj[key] === undefined) {
            obj[key] = dec(valueSlice(str, eqIdx + 1, endIdx));
        }
        index = endIdx + 1;
    } while (index < len);
    return obj;
}
/**
 * Stringifies an object into an HTTP `Cookie` header.
 */
function stringifyCookie(cookie, options) {
    const enc = options?.encode || encodeURIComponent;
    const cookieStrings = [];
    for (const name of Object.keys(cookie)) {
        const val = cookie[name];
        if (val === undefined)
            continue;
        if (!cookieNameRegExp.test(name)) {
            throw new TypeError(`cookie name is invalid: ${name}`);
        }
        const value = enc(val);
        if (!cookieValueRegExp.test(value)) {
            throw new TypeError(`cookie val is invalid: ${val}`);
        }
        cookieStrings.push(`${name}=${value}`);
    }
    return cookieStrings.join("; ");
}
function stringifySetCookie(_name, _val, _opts) {
    const cookie = typeof _name === "object"
        ? _name
        : { ..._opts, name: _name, value: String(_val) };
    const options = typeof _val === "object" ? _val : _opts;
    const enc = options?.encode || encodeURIComponent;
    if (!cookieNameRegExp.test(cookie.name)) {
        throw new TypeError(`argument name is invalid: ${cookie.name}`);
    }
    const value = cookie.value ? enc(cookie.value) : "";
    if (!cookieValueRegExp.test(value)) {
        throw new TypeError(`argument val is invalid: ${cookie.value}`);
    }
    let str = cookie.name + "=" + value;
    if (cookie.maxAge !== undefined) {
        if (!Number.isInteger(cookie.maxAge)) {
            throw new TypeError(`option maxAge is invalid: ${cookie.maxAge}`);
        }
        str += "; Max-Age=" + cookie.maxAge;
    }
    if (cookie.domain) {
        if (!domainValueRegExp.test(cookie.domain)) {
            throw new TypeError(`option domain is invalid: ${cookie.domain}`);
        }
        str += "; Domain=" + cookie.domain;
    }
    if (cookie.path) {
        if (!pathValueRegExp.test(cookie.path)) {
            throw new TypeError(`option path is invalid: ${cookie.path}`);
        }
        str += "; Path=" + cookie.path;
    }
    if (cookie.expires) {
        if (!isDate(cookie.expires) || !Number.isFinite(cookie.expires.valueOf())) {
            throw new TypeError(`option expires is invalid: ${cookie.expires}`);
        }
        str += "; Expires=" + cookie.expires.toUTCString();
    }
    if (cookie.httpOnly) {
        str += "; HttpOnly";
    }
    if (cookie.secure) {
        str += "; Secure";
    }
    if (cookie.partitioned) {
        str += "; Partitioned";
    }
    if (cookie.priority) {
        const priority = typeof cookie.priority === "string"
            ? cookie.priority.toLowerCase()
            : undefined;
        switch (priority) {
            case "low":
                str += "; Priority=Low";
                break;
            case "medium":
                str += "; Priority=Medium";
                break;
            case "high":
                str += "; Priority=High";
                break;
            default:
                throw new TypeError(`option priority is invalid: ${cookie.priority}`);
        }
    }
    if (cookie.sameSite) {
        const sameSite = typeof cookie.sameSite === "string"
            ? cookie.sameSite.toLowerCase()
            : cookie.sameSite;
        switch (sameSite) {
            case true:
            case "strict":
                str += "; SameSite=Strict";
                break;
            case "lax":
                str += "; SameSite=Lax";
                break;
            case "none":
                str += "; SameSite=None";
                break;
            default:
                throw new TypeError(`option sameSite is invalid: ${cookie.sameSite}`);
        }
    }
    return str;
}
/**
 * Deserialize a `Set-Cookie` header into an object.
 *
 * deserialize('foo=bar; httpOnly')
 *   => { name: 'foo', value: 'bar', httpOnly: true }
 */
function parseSetCookie(str, options) {
    const dec = options?.decode || decode;
    const len = str.length;
    const endIdx = endIndex(str, 0, len);
    const eqIdx = eqIndex(str, 0, endIdx);
    const setCookie = eqIdx === -1
        ? { name: "", value: dec(valueSlice(str, 0, endIdx)) }
        : {
            name: valueSlice(str, 0, eqIdx),
            value: dec(valueSlice(str, eqIdx + 1, endIdx)),
        };
    let index = endIdx + 1;
    while (index < len) {
        const endIdx = endIndex(str, index, len);
        const eqIdx = eqIndex(str, index, endIdx);
        const attr = eqIdx === -1
            ? valueSlice(str, index, endIdx)
            : valueSlice(str, index, eqIdx);
        const val = eqIdx === -1 ? undefined : valueSlice(str, eqIdx + 1, endIdx);
        switch (attr.toLowerCase()) {
            case "httponly":
                setCookie.httpOnly = true;
                break;
            case "secure":
                setCookie.secure = true;
                break;
            case "partitioned":
                setCookie.partitioned = true;
                break;
            case "domain":
                setCookie.domain = val;
                break;
            case "path":
                setCookie.path = val;
                break;
            case "max-age":
                if (val && maxAgeRegExp.test(val))
                    setCookie.maxAge = Number(val);
                break;
            case "expires":
                if (!val)
                    break;
                const date = new Date(val);
                if (Number.isFinite(date.valueOf()))
                    setCookie.expires = date;
                break;
            case "priority":
                if (!val)
                    break;
                const priority = val.toLowerCase();
                if (priority === "low" ||
                    priority === "medium" ||
                    priority === "high") {
                    setCookie.priority = priority;
                }
                break;
            case "samesite":
                if (!val)
                    break;
                const sameSite = val.toLowerCase();
                if (sameSite === "lax" ||
                    sameSite === "strict" ||
                    sameSite === "none") {
                    setCookie.sameSite = sameSite;
                }
                break;
        }
        index = endIdx + 1;
    }
    return setCookie;
}
/**
 * Find the `;` character between `min` and `len` in str.
 */
function endIndex(str, min, len) {
    const index = str.indexOf(";", min);
    return index === -1 ? len : index;
}
/**
 * Find the `=` character between `min` and `max` in str.
 */
function eqIndex(str, min, max) {
    const index = str.indexOf("=", min);
    return index < max ? index : -1;
}
/**
 * Slice out a value between startPod to max.
 */
function valueSlice(str, min, max) {
    let start = min;
    let end = max;
    do {
        const code = str.charCodeAt(start);
        if (code !== 0x20 /*   */ && code !== 0x09 /* \t */)
            break;
    } while (++start < end);
    while (end > start) {
        const code = str.charCodeAt(end - 1);
        if (code !== 0x20 /*   */ && code !== 0x09 /* \t */)
            break;
        end--;
    }
    return str.slice(start, end);
}
/**
 * URL-decode string value. Optimized to skip native call when no %.
 */
function decode(str) {
    if (str.indexOf("%") === -1)
        return str;
    try {
        return decodeURIComponent(str);
    }
    catch (e) {
        return str;
    }
}
/**
 * Determine if value is a Date.
 */
function isDate(val) {
    return __toString.call(val) === "[object Date]";
}

/**
 * A `StructFailure` represents a single specific failure in validation.
 */
/**
 * `StructError` objects are thrown (or returned) when validation fails.
 *
 * Validation logic is design to exit early for maximum performance. The error
 * represents the first error encountered during validation. For more detail,
 * the `error.failures` property is a generator function that can be run to
 * continue validation and receive all the failures in the data.
 */
class StructError extends TypeError {
    constructor(failure, failures) {
        let cached;
        const { message, explanation, ...rest } = failure;
        const { path } = failure;
        const msg = path.length === 0 ? message : `At path: ${path.join('.')} -- ${message}`;
        super(explanation ?? msg);
        if (explanation != null)
            this.cause = msg;
        Object.assign(this, rest);
        this.name = this.constructor.name;
        this.failures = () => {
            return (cached ?? (cached = [failure, ...failures()]));
        };
    }
}

/**
 * Check if a value is an iterator.
 */
function isIterable(x) {
    return isObject(x) && typeof x[Symbol.iterator] === 'function';
}
/**
 * Check if a value is a plain object.
 */
function isObject(x) {
    return typeof x === 'object' && x != null;
}
/**
 * Return a value as a printable string.
 */
function print(value) {
    if (typeof value === 'symbol') {
        return value.toString();
    }
    return typeof value === 'string' ? JSON.stringify(value) : `${value}`;
}
/**
 * Shifts (removes and returns) the first value from the `input` iterator.
 * Like `Array.prototype.shift()` but for an `Iterator`.
 */
function shiftIterator(input) {
    const { done, value } = input.next();
    return done ? undefined : value;
}
/**
 * Convert a single validation result to a failure.
 */
function toFailure(result, context, struct, value) {
    if (result === true) {
        return;
    }
    else if (result === false) {
        result = {};
    }
    else if (typeof result === 'string') {
        result = { message: result };
    }
    const { path, branch } = context;
    const { type } = struct;
    const { refinement, message = `Expected a value of type \`${type}\`${refinement ? ` with refinement \`${refinement}\`` : ''}, but received: \`${print(value)}\``, } = result;
    return {
        value,
        type,
        refinement,
        key: path[path.length - 1],
        path,
        branch,
        ...result,
        message,
    };
}
/**
 * Convert a validation result to an iterable of failures.
 */
function* toFailures(result, context, struct, value) {
    if (!isIterable(result)) {
        result = [result];
    }
    for (const r of result) {
        const failure = toFailure(r, context, struct, value);
        if (failure) {
            yield failure;
        }
    }
}
/**
 * Check a value against a struct, traversing deeply into nested values, and
 * returning an iterator of failures or success.
 */
function* run(value, struct, options = {}) {
    const { path = [], branch = [value], coerce = false, mask = false } = options;
    const ctx = { path, branch };
    if (coerce) {
        value = struct.coercer(value, ctx);
        if (mask &&
            struct.type !== 'type' &&
            isObject(struct.schema) &&
            isObject(value) &&
            !Array.isArray(value)) {
            for (const key in value) {
                if (struct.schema[key] === undefined) {
                    delete value[key];
                }
            }
        }
    }
    let status = 'valid';
    for (const failure of struct.validator(value, ctx)) {
        failure.explanation = options.message;
        status = 'not_valid';
        yield [failure, undefined];
    }
    for (let [k, v, s] of struct.entries(value, ctx)) {
        const ts = run(v, s, {
            path: k === undefined ? path : [...path, k],
            branch: k === undefined ? branch : [...branch, v],
            coerce,
            mask,
            message: options.message,
        });
        for (const t of ts) {
            if (t[0]) {
                status = t[0].refinement != null ? 'not_refined' : 'not_valid';
                yield [t[0], undefined];
            }
            else if (coerce) {
                v = t[1];
                if (k === undefined) {
                    value = v;
                }
                else if (value instanceof Map) {
                    value.set(k, v);
                }
                else if (value instanceof Set) {
                    value.add(v);
                }
                else if (isObject(value)) {
                    if (v !== undefined || k in value)
                        value[k] = v;
                }
            }
        }
    }
    if (status !== 'not_valid') {
        for (const failure of struct.refiner(value, ctx)) {
            failure.explanation = options.message;
            status = 'not_refined';
            yield [failure, undefined];
        }
    }
    if (status === 'valid') {
        yield [undefined, value];
    }
}

/**
 * `Struct` objects encapsulate the validation logic for a specific type of
 * values. Once constructed, you use the `assert`, `is` or `validate` helpers to
 * validate unknown input data against the struct.
 */
class Struct {
    constructor(props) {
        const { type, schema, validator, refiner, coercer = (value) => value, entries = function* () { }, } = props;
        this.type = type;
        this.schema = schema;
        this.entries = entries;
        this.coercer = coercer;
        if (validator) {
            this.validator = (value, context) => {
                const result = validator(value, context);
                return toFailures(result, context, this, value);
            };
        }
        else {
            this.validator = () => [];
        }
        if (refiner) {
            this.refiner = (value, context) => {
                const result = refiner(value, context);
                return toFailures(result, context, this, value);
            };
        }
        else {
            this.refiner = () => [];
        }
    }
    /**
     * Assert that a value passes the struct's validation, throwing if it doesn't.
     */
    assert(value, message) {
        return assert(value, this, message);
    }
    /**
     * Create a value with the struct's coercion logic, then validate it.
     */
    create(value, message) {
        return create(value, this, message);
    }
    /**
     * Check if a value passes the struct's validation.
     */
    is(value) {
        return is(value, this);
    }
    /**
     * Mask a value, coercing and validating it, but returning only the subset of
     * properties defined by the struct's schema.
     */
    mask(value, message) {
        return mask(value, this, message);
    }
    /**
     * Validate a value with the struct's validation logic, returning a tuple
     * representing the result.
     *
     * You may optionally pass `true` for the `withCoercion` argument to coerce
     * the value before attempting to validate it. If you do, the result will
     * contain the coerced result when successful.
     */
    validate(value, options = {}) {
        return validate(value, this, options);
    }
}
/**
 * Assert that a value passes a struct, throwing if it doesn't.
 */
function assert(value, struct, message) {
    const result = validate(value, struct, { message });
    if (result[0]) {
        throw result[0];
    }
}
/**
 * Create a value with the coercion logic of struct and validate it.
 */
function create(value, struct, message) {
    const result = validate(value, struct, { coerce: true, message });
    if (result[0]) {
        throw result[0];
    }
    else {
        return result[1];
    }
}
/**
 * Mask a value, returning only the subset of properties defined by a struct.
 */
function mask(value, struct, message) {
    const result = validate(value, struct, { coerce: true, mask: true, message });
    if (result[0]) {
        throw result[0];
    }
    else {
        return result[1];
    }
}
/**
 * Check if a value passes a struct.
 */
function is(value, struct) {
    const result = validate(value, struct);
    return !result[0];
}
/**
 * Validate a value against a struct, returning an error if invalid, or the
 * value (with potential coercion) if valid.
 */
function validate(value, struct, options = {}) {
    const tuples = run(value, struct, options);
    const tuple = shiftIterator(tuples);
    if (tuple[0]) {
        const error = new StructError(tuple[0], function* () {
            for (const t of tuples) {
                if (t[0]) {
                    yield t[0];
                }
            }
        });
        return [error, undefined];
    }
    else {
        const v = tuple[1];
        return [undefined, v];
    }
}
/**
 * Define a new struct type with a custom validation function.
 */
function define(name, validator) {
    return new Struct({ type: name, schema: null, validator });
}
function literal(constant) {
    const description = print(constant);
    return new Struct({
        type: 'literal',
        schema: constant ,
        validator(value) {
            return (value === constant ||
                `Expected the literal \`${description}\`, but received: ${print(value)}`);
        },
    });
}
/**
 * Ensure that a value is a number.
 */
function number$1() {
    return define('number', (value) => {
        return ((typeof value === 'number' && !isNaN(value)) ||
            `Expected a number, but received: ${print(value)}`);
    });
}
/**
 * Ensure that a value is a string.
 */
function string() {
    return define('string', (value) => {
        return (typeof value === 'string' ||
            `Expected a string, but received: ${print(value)}`);
    });
}
/**
 * Ensure that a value has a set of known properties of specific types.
 *
 * Note: Unrecognized properties are allowed and untouched. This is similar to
 * how TypeScript's structural typing works.
 */
function type(schema) {
    const keys = Object.keys(schema);
    return new Struct({
        type: 'type',
        schema,
        *entries(value) {
            if (isObject(value)) {
                for (const k of keys) {
                    yield [k, value[k], schema[k]];
                }
            }
        },
        validator(value) {
            return (isObject(value) || `Expected an object, but received: ${print(value)}`);
        },
        coercer(value) {
            return isObject(value) ? { ...value } : value;
        },
    });
}

function bytesToHex(bytes) {
  let str = "";
  for (const byte of bytes) {
    str += byte.toString(16).padStart(2, "0");
  }
  return str;
}
function redirect(to, initialHeaders) {
  return {
    body: null,
    status: 307,
    headers: [...initialHeaders !== null && initialHeaders !== void 0 ? initialHeaders : [], ["Location", to]]
  };
}
const localModeApiHandler = () => async () => ({
  status: 500,
  body: "The Keystatic API route is running in a non-Node.js environment which is not supported with `storage: { kind: 'local' }`"
});
const webcrypto = crypto;
function base64UrlDecode(base64) {
  const binString = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}
function base64UrlEncode(bytes) {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function base64Encode(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
async function deriveKey(secret, salt) {
  if (secret.length < 32) {
    throw new Error("KEYSTATIC_SECRET must be at least 32 characters long");
  }
  const encoded = encoder.encode(secret);
  const key = await webcrypto.subtle.importKey("raw", encoded, "HKDF", false, ["deriveKey"]);
  return webcrypto.subtle.deriveKey({
    name: "HKDF",
    salt,
    hash: "SHA-256",
    info: new Uint8Array(0)
  }, key, {
    name: "AES-GCM",
    length: 256
  }, false, ["encrypt", "decrypt"]);
}
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
async function encryptValue(value, secret) {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(secret, salt);
  const encoded = encoder.encode(value);
  const encrypted = await webcrypto.subtle.encrypt({
    name: "AES-GCM",
    iv
  }, key, encoded);
  const full = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.byteLength);
  full.set(salt);
  full.set(iv, SALT_LENGTH);
  full.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);
  return base64UrlEncode(full);
}
async function decryptValue(encrypted, secret) {
  const decoded = base64UrlDecode(encrypted);
  const salt = decoded.slice(0, SALT_LENGTH);
  const key = await deriveKey(secret, salt);
  const iv = decoded.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const value = decoded.slice(SALT_LENGTH + IV_LENGTH);
  const decrypted = await webcrypto.subtle.decrypt({
    name: "AES-GCM",
    iv
  }, key, value);
  return decoder.decode(decrypted);
}
const keystaticRouteRegex = /^branch\/[^]+(\/collection\/[^/]+(|\/(create|item\/[^/]+))|\/singleton\/[^/]+)?$/;
const keyToEnvVar = {
  clientId: "KEYSTATIC_GITHUB_CLIENT_ID",
  clientSecret: "KEYSTATIC_GITHUB_CLIENT_SECRET",
  secret: "KEYSTATIC_SECRET"
};
function tryOrUndefined$1(fn) {
  try {
    return fn();
  } catch {
    return void 0;
  }
}
function makeGenericAPIRouteHandler(_config, options) {
  var _config$clientId, _config$clientSecret, _config$secret;
  const _config2 = {
    clientId: (_config$clientId = _config.clientId) !== null && _config$clientId !== void 0 ? _config$clientId : tryOrUndefined$1(() => process.env.KEYSTATIC_GITHUB_CLIENT_ID),
    clientSecret: (_config$clientSecret = _config.clientSecret) !== null && _config$clientSecret !== void 0 ? _config$clientSecret : tryOrUndefined$1(() => process.env.KEYSTATIC_GITHUB_CLIENT_SECRET),
    secret: (_config$secret = _config.secret) !== null && _config$secret !== void 0 ? _config$secret : tryOrUndefined$1(() => process.env.KEYSTATIC_SECRET),
    config: _config.config
  };
  const getParams = (req) => {
    let url;
    try {
      url = new URL(req.url);
    } catch (err) {
      throw new Error(`Found incomplete URL in Keystatic API route URL handler${(options === null || options === void 0 ? void 0 : options.slugEnvName) === "NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG" ? ". Make sure you're using the latest version of @keystatic/next" : ""}`);
    }
    return url.pathname.replace(/^\/api\/keystatic\/?/, "").split("/").map((x) => decodeURIComponent(x)).filter(Boolean);
  };
  if (_config2.config.storage.kind === "local") {
    const handler = localModeApiHandler();
    return (req) => {
      const params = getParams(req);
      return handler(req, params);
    };
  }
  if (_config2.config.storage.kind === "cloud") {
    return async function keystaticAPIRoute() {
      return {
        status: 404,
        body: "Not Found"
      };
    };
  }
  if (!_config2.clientId || !_config2.clientSecret || !_config2.secret) {
    {
      const missingKeys = ["clientId", "clientSecret", "secret"].filter((x) => !_config2[x]);
      throw new Error(`Missing required config in Keystatic API setup when using the 'github' storage mode:
${missingKeys.map((key) => `- ${key} (can be provided via ${keyToEnvVar[key]} env var)`).join("\n")}

If you've created your GitHub app locally, make sure to copy the environment variables from your local env file to your deployed environment`);
    }
  }
  const config = {
    clientId: _config2.clientId,
    clientSecret: _config2.clientSecret,
    secret: _config2.secret,
    config: _config2.config
  };
  return async function keystaticAPIRoute(req) {
    const params = getParams(req);
    const joined = params.join("/");
    if (joined === "github/oauth/callback") {
      return githubOauthCallback(req, config);
    }
    if (joined === "github/login") {
      return githubLogin(req, config);
    }
    if (joined === "github/refresh-token") {
      return githubRefreshToken(req, config);
    }
    if (joined === "github/repo-not-found") {
      return githubRepoNotFound(req, config);
    }
    if (joined === "github/logout") {
      var _req$headers$get;
      const cookies = parse$1((_req$headers$get = req.headers.get("cookie")) !== null && _req$headers$get !== void 0 ? _req$headers$get : "");
      const access_token = cookies["keystatic-gh-access-token"];
      if (access_token) {
        await fetch(`https://api.github.com/applications/${config.clientId}/token`, {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${btoa(config.clientId + ":" + config.clientSecret)}`
          },
          body: JSON.stringify({
            access_token
          })
        });
      }
      return redirect("/keystatic", [["Set-Cookie", immediatelyExpiringCookie("keystatic-gh-access-token")], ["Set-Cookie", immediatelyExpiringCookie("keystatic-gh-refresh-token")]]);
    }
    if (joined === "github/created-app") {
      return {
        status: 404,
        body: "It looks like you just tried to create a GitHub App for Keystatic but there is already a GitHub App configured for Keystatic.\n\nYou may be here because you started creating a GitHub App but then started the process again elsewhere and completed it there. You should likely go back to Keystatic and sign in with GitHub to continue."
      };
    }
    return {
      status: 404,
      body: "Not Found"
    };
  };
}
const tokenDataResultType = type({
  access_token: string(),
  expires_in: number$1(),
  refresh_token: string(),
  refresh_token_expires_in: number$1(),
  scope: string(),
  token_type: literal("bearer")
});
async function githubOauthCallback(req, config) {
  var _req$headers$get2;
  const searchParams = new URL(req.url, "http://localhost").searchParams;
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  if (typeof errorDescription === "string") {
    return {
      status: 400,
      body: `An error occurred when trying to authenticate with GitHub:
${errorDescription}${error === "redirect_uri_mismatch" ? `

If you were trying to sign in locally and recently upgraded Keystatic from @keystatic/core@0.0.69 or below, you need to add \`http://127.0.0.1/api/keystatic/github/oauth/callback\` as a callback URL in your GitHub app.` : ""}`
    };
  }
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (typeof code !== "string") {
    return {
      status: 400,
      body: "Bad Request"
    };
  }
  const cookies = parse$1((_req$headers$get2 = req.headers.get("cookie")) !== null && _req$headers$get2 !== void 0 ? _req$headers$get2 : "");
  const fromCookie = state ? cookies["ks-" + state] : void 0;
  const from = typeof fromCookie === "string" && keystaticRouteRegex.test(fromCookie) ? fromCookie : void 0;
  const url = new URL("https://github.com/login/oauth/access_token");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("code", code);
  const tokenRes = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json"
    }
  });
  if (!tokenRes.ok) {
    return {
      status: 401,
      body: "Authorization failed"
    };
  }
  const _tokenData = await tokenRes.json();
  let tokenData;
  try {
    tokenData = tokenDataResultType.create(_tokenData);
  } catch {
    return {
      status: 401,
      body: "Authorization failed"
    };
  }
  const headers = await getTokenCookies(tokenData, config);
  if (state === "close") {
    return {
      headers: [...headers, ["Content-Type", "text/html"]],
      body: "<script>localStorage.setItem('ks-refetch-installations', 'true');window.close();</script>",
      status: 200
    };
  }
  return redirect(`/keystatic${from ? `/${from}` : ""}`, headers);
}
async function getTokenCookies(tokenData, config) {
  const headers = [["Set-Cookie", serialize("keystatic-gh-access-token", tokenData.access_token, {
    sameSite: "lax",
    secure: true,
    maxAge: tokenData.expires_in,
    expires: new Date(Date.now() + tokenData.expires_in * 1e3),
    path: "/"
  })], ["Set-Cookie", serialize("keystatic-gh-refresh-token", await encryptValue(tokenData.refresh_token, config.secret), {
    sameSite: "lax",
    secure: true,
    httpOnly: true,
    maxAge: tokenData.refresh_token_expires_in,
    expires: new Date(Date.now() + tokenData.refresh_token_expires_in * 100),
    path: "/"
  })]];
  return headers;
}
async function getRefreshToken(req, config) {
  const cookies = parse$1(req.headers.get("cookie") || "");
  const refreshTokenCookie = cookies["keystatic-gh-refresh-token"];
  if (!refreshTokenCookie) return;
  let refreshToken;
  try {
    refreshToken = await decryptValue(refreshTokenCookie, config.secret);
  } catch {
    return;
  }
  return refreshToken;
}
async function githubRefreshToken(req, config) {
  const headers = await refreshGitHubAuth(req, config);
  if (!headers) {
    return {
      status: 401,
      body: "Authorization failed"
    };
  }
  return {
    status: 200,
    headers,
    body: ""
  };
}
async function refreshGitHubAuth(req, config) {
  const refreshToken = await getRefreshToken(req, config);
  if (!refreshToken) {
    return;
  }
  const url = new URL("https://github.com/login/oauth/access_token");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("refresh_token", refreshToken);
  const tokenRes = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json"
    }
  });
  if (!tokenRes.ok) {
    return;
  }
  const _tokenData = await tokenRes.json();
  let tokenData;
  try {
    tokenData = tokenDataResultType.create(_tokenData);
  } catch {
    return;
  }
  return getTokenCookies(tokenData, config);
}
async function githubRepoNotFound(req, config) {
  const headers = await refreshGitHubAuth(req, config);
  if (headers) {
    return redirect("/keystatic/repo-not-found", headers);
  }
  return githubLogin(req, config);
}
async function githubLogin(req, config) {
  const reqUrl = new URL(req.url);
  const rawFrom = reqUrl.searchParams.get("from");
  const from = typeof rawFrom === "string" && keystaticRouteRegex.test(rawFrom) ? rawFrom : "/";
  const state = bytesToHex(webcrypto.getRandomValues(new Uint8Array(10)));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", `${reqUrl.origin}/api/keystatic/github/oauth/callback`);
  if (from === "/") {
    return redirect(url.toString());
  }
  url.searchParams.set("state", state);
  return redirect(url.toString(), [["Set-Cookie", serialize("ks-" + state, from, {
    sameSite: "lax",
    secure: true,
    // 1 day
    maxAge: 60 * 60 * 24,
    expires: new Date(Date.now() + 60 * 60 * 24 * 1e3),
    path: "/",
    httpOnly: true
  })]]);
}
function immediatelyExpiringCookie(name) {
  return serialize(name, "", {
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: /* @__PURE__ */ new Date()
  });
}

var setCookie = {exports: {}};

var defaultParseOptions = {
  decodeValues: true,
  map: false,
  silent: false,
};

function isForbiddenKey(key) {
  return typeof key !== "string" || key in {};
}

function createNullObj() {
  return Object.create(null);
}

function isNonEmptyString(str) {
  return typeof str === "string" && !!str.trim();
}

function parseString(setCookieValue, options) {
  var parts = setCookieValue.split(";").filter(isNonEmptyString);

  var nameValuePairStr = parts.shift();
  var parsed = parseNameValuePair(nameValuePairStr);
  var name = parsed.name;
  var value = parsed.value;

  options = options
    ? Object.assign({}, defaultParseOptions, options)
    : defaultParseOptions;

  if (isForbiddenKey(name)) {
    return null;
  }

  try {
    value = options.decodeValues ? decodeURIComponent(value) : value; // decode cookie value
  } catch (e) {
    console.error(
      "set-cookie-parser: failed to decode cookie value. Set options.decodeValues=false to disable decoding.",
      e
    );
  }

  var cookie = createNullObj();
  cookie.name = name;
  cookie.value = value;

  parts.forEach(function (part) {
    var sides = part.split("=");
    var key = sides.shift().trimLeft().toLowerCase();
    if (isForbiddenKey(key)) {
      return;
    }
    var value = sides.join("=");
    if (key === "expires") {
      cookie.expires = new Date(value);
    } else if (key === "max-age") {
      var n = parseInt(value, 10);
      if (!Number.isNaN(n)) cookie.maxAge = n;
    } else if (key === "secure") {
      cookie.secure = true;
    } else if (key === "httponly") {
      cookie.httpOnly = true;
    } else if (key === "samesite") {
      cookie.sameSite = value;
    } else if (key === "partitioned") {
      cookie.partitioned = true;
    } else if (key) {
      cookie[key] = value;
    }
  });

  return cookie;
}

function parseNameValuePair(nameValuePairStr) {
  // Parses name-value-pair according to rfc6265bis draft

  var name = "";
  var value = "";
  var nameValueArr = nameValuePairStr.split("=");
  if (nameValueArr.length > 1) {
    name = nameValueArr.shift();
    value = nameValueArr.join("="); // everything after the first =, joined by a "=" if there was more than one part
  } else {
    value = nameValuePairStr;
  }

  return { name: name, value: value };
}

function parse(input, options) {
  options = options
    ? Object.assign({}, defaultParseOptions, options)
    : defaultParseOptions;

  if (!input) {
    if (!options.map) {
      return [];
    } else {
      return createNullObj();
    }
  }

  if (input.headers) {
    if (typeof input.headers.getSetCookie === "function") {
      // for fetch responses - they combine headers of the same type in the headers array,
      // but getSetCookie returns an uncombined array
      input = input.headers.getSetCookie();
    } else if (input.headers["set-cookie"]) {
      // fast-path for node.js (which automatically normalizes header names to lower-case)
      input = input.headers["set-cookie"];
    } else {
      // slow-path for other environments - see #25
      var sch =
        input.headers[
          Object.keys(input.headers).find(function (key) {
            return key.toLowerCase() === "set-cookie";
          })
        ];
      // warn if called on a request-like object with a cookie header rather than a set-cookie header - see #34, 36
      if (!sch && input.headers.cookie && !options.silent) {
        console.warn(
          "Warning: set-cookie-parser appears to have been called on a request object. It is designed to parse Set-Cookie headers from responses, not Cookie headers from requests. Set the option {silent: true} to suppress this warning."
        );
      }
      input = sch;
    }
  }
  if (!Array.isArray(input)) {
    input = [input];
  }

  if (!options.map) {
    return input
      .filter(isNonEmptyString)
      .map(function (str) {
        return parseString(str, options);
      })
      .filter(Boolean);
  } else {
    var cookies = createNullObj();
    return input.filter(isNonEmptyString).reduce(function (cookies, str) {
      var cookie = parseString(str, options);
      if (cookie && !isForbiddenKey(cookie.name)) {
        cookies[cookie.name] = cookie;
      }
      return cookies;
    }, cookies);
  }
}

/*
  Set-Cookie header field-values are sometimes comma joined in one string. This splits them without choking on commas
  that are within a single set-cookie field-value, such as in the Expires portion.

  This is uncommon, but explicitly allowed - see https://tools.ietf.org/html/rfc2616#section-4.2
  Node.js does this for every header *except* set-cookie - see https://github.com/nodejs/node/blob/d5e363b77ebaf1caf67cd7528224b651c86815c1/lib/_http_incoming.js#L128
  React Native's fetch does this for *every* header, including set-cookie.

  Based on: https://github.com/google/j2objc/commit/16820fdbc8f76ca0c33472810ce0cb03d20efe25
  Credits to: https://github.com/tomball for original and https://github.com/chrusart for JavaScript implementation
*/
function splitCookiesString(cookiesString) {
  if (Array.isArray(cookiesString)) {
    return cookiesString;
  }
  if (typeof cookiesString !== "string") {
    return [];
  }

  var cookiesStrings = [];
  var pos = 0;
  var start;
  var ch;
  var lastComma;
  var nextStart;
  var cookiesSeparatorFound;

  function skipWhitespace() {
    while (pos < cookiesString.length && /\s/.test(cookiesString.charAt(pos))) {
      pos += 1;
    }
    return pos < cookiesString.length;
  }

  function notSpecialChar() {
    ch = cookiesString.charAt(pos);

    return ch !== "=" && ch !== ";" && ch !== ",";
  }

  while (pos < cookiesString.length) {
    start = pos;
    cookiesSeparatorFound = false;

    while (skipWhitespace()) {
      ch = cookiesString.charAt(pos);
      if (ch === ",") {
        // ',' is a cookie separator if we have later first '=', not ';' or ','
        lastComma = pos;
        pos += 1;

        skipWhitespace();
        nextStart = pos;

        while (pos < cookiesString.length && notSpecialChar()) {
          pos += 1;
        }

        // currently special character
        if (pos < cookiesString.length && cookiesString.charAt(pos) === "=") {
          // we found cookies separator
          cookiesSeparatorFound = true;
          // pos is inside the next cookie, so back up and return it.
          pos = nextStart;
          cookiesStrings.push(cookiesString.substring(start, lastComma));
          start = pos;
        } else {
          // in param ',' or param separator ';',
          // we continue from that comma
          pos = lastComma + 1;
        }
      } else {
        pos += 1;
      }
    }

    if (!cookiesSeparatorFound || pos >= cookiesString.length) {
      cookiesStrings.push(cookiesString.substring(start, cookiesString.length));
    }
  }

  return cookiesStrings;
}

setCookie.exports = parse;
setCookie.exports.parse = parse;
var parseString_1 = setCookie.exports.parseString = parseString;
setCookie.exports.splitCookiesString = splitCookiesString;

function makeHandler(_config) {
  return async function keystaticAPIRoute(context) {
    var _context$locals, _ref, _config$clientId, _ref2, _config$clientSecret, _ref3, _config$secret;
    const envVarsForCf = (_context$locals = context.locals) === null || _context$locals === void 0 || (_context$locals = _context$locals.runtime) === null || _context$locals === void 0 ? void 0 : _context$locals.env;
    const handler = makeGenericAPIRouteHandler({
      ..._config,
      clientId: (_ref = (_config$clientId = _config.clientId) !== null && _config$clientId !== void 0 ? _config$clientId : envVarsForCf === null || envVarsForCf === void 0 ? void 0 : envVarsForCf.KEYSTATIC_GITHUB_CLIENT_ID) !== null && _ref !== void 0 ? _ref : tryOrUndefined(() => {
        return undefined                                          ;
      }),
      clientSecret: (_ref2 = (_config$clientSecret = _config.clientSecret) !== null && _config$clientSecret !== void 0 ? _config$clientSecret : envVarsForCf === null || envVarsForCf === void 0 ? void 0 : envVarsForCf.KEYSTATIC_GITHUB_CLIENT_SECRET) !== null && _ref2 !== void 0 ? _ref2 : tryOrUndefined(() => {
        return undefined                                              ;
      }),
      secret: (_ref3 = (_config$secret = _config.secret) !== null && _config$secret !== void 0 ? _config$secret : envVarsForCf === null || envVarsForCf === void 0 ? void 0 : envVarsForCf.KEYSTATIC_SECRET) !== null && _ref3 !== void 0 ? _ref3 : tryOrUndefined(() => {
        return undefined                                ;
      })
    }, {
      slugEnvName: "PUBLIC_KEYSTATIC_GITHUB_APP_SLUG"
    });
    const {
      body,
      headers,
      status
    } = await handler(context.request);
    let headersInADifferentStructure = /* @__PURE__ */ new Map();
    if (headers) {
      if (Array.isArray(headers)) {
        for (const [key, value] of headers) {
          if (!headersInADifferentStructure.has(key.toLowerCase())) {
            headersInADifferentStructure.set(key.toLowerCase(), []);
          }
          headersInADifferentStructure.get(key.toLowerCase()).push(value);
        }
      } else if (typeof headers.entries === "function") {
        for (const [key, value] of headers.entries()) {
          headersInADifferentStructure.set(key.toLowerCase(), [value]);
        }
        if ("getSetCookie" in headers && typeof headers.getSetCookie === "function") {
          const setCookieHeaders2 = headers.getSetCookie();
          if (setCookieHeaders2 !== null && setCookieHeaders2 !== void 0 && setCookieHeaders2.length) {
            headersInADifferentStructure.set("set-cookie", setCookieHeaders2);
          }
        }
      } else {
        for (const [key, value] of Object.entries(headers)) {
          headersInADifferentStructure.set(key.toLowerCase(), [value]);
        }
      }
    }
    const setCookieHeaders = headersInADifferentStructure.get("set-cookie");
    headersInADifferentStructure.delete("set-cookie");
    if (setCookieHeaders) {
      for (const setCookieValue of setCookieHeaders) {
        var _options$sameSite;
        const {
          name,
          value,
          ...options
        } = parseString_1(setCookieValue);
        const sameSite = (_options$sameSite = options.sameSite) === null || _options$sameSite === void 0 ? void 0 : _options$sameSite.toLowerCase();
        context.cookies.set(name, value, {
          domain: options.domain,
          expires: options.expires,
          httpOnly: options.httpOnly,
          maxAge: options.maxAge,
          path: options.path,
          sameSite: sameSite === "lax" || sameSite === "strict" || sameSite === "none" ? sameSite : void 0
        });
      }
    }
    return new Response(body, {
      status,
      headers: [...headersInADifferentStructure.entries()].flatMap(([key, val]) => val.map((x) => [key, x]))
    });
  };
}
function tryOrUndefined(fn) {
  try {
    return fn();
  } catch {
    return void 0;
  }
}

var jsxRuntime = {exports: {}};

var reactJsxRuntime_production = {};

/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"),
  REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
function jsxProd(type, config, maybeKey) {
  var key = null;
  void 0 !== maybeKey && (key = "" + maybeKey);
  void 0 !== config.key && (key = "" + config.key);
  if ("key" in config) {
    maybeKey = {};
    for (var propName in config)
      "key" !== propName && (maybeKey[propName] = config[propName]);
  } else maybeKey = config;
  config = maybeKey.ref;
  return {
    $$typeof: REACT_ELEMENT_TYPE,
    type: type,
    key: key,
    ref: void 0 !== config ? config : null,
    props: maybeKey
  };
}
reactJsxRuntime_production.Fragment = REACT_FRAGMENT_TYPE;
reactJsxRuntime_production.jsx = jsxProd;
reactJsxRuntime_production.jsxs = jsxProd;

{
  jsxRuntime.exports = reactJsxRuntime_production;
}

var jsxRuntimeExports = jsxRuntime.exports;

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __markAsModule = (target) => __defProp(target, "__esModule", { value: true });
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  __markAsModule(target);
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __reExport = (target, module, desc) => {
  if (module && typeof module === "object" || typeof module === "function") {
    for (let key of __getOwnPropNames(module))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, { get: () => module[key], enumerable: !(desc = __getOwnPropDesc(module, key)) || desc.enumerable });
  }
  return target;
};
var __toModule = (module) => {
  return __reExport(__markAsModule(__defProp(module != null ? __create(__getProtoOf(module)) : {}, "default", module && module.__esModule && "default" in module ? { get: () => module.default, enumerable: true } : { value: module, enumerable: true })), module);
};

// src/grammar/tag.js
var require_tag = __commonJS({
  "src/grammar/tag.js"(exports, module) {
    function peg$subclass(child, parent) {
      function C() {
        this.constructor = child;
      }
      C.prototype = parent.prototype;
      child.prototype = new C();
    }
    function peg$SyntaxError(message, expected, found, location) {
      this.message = message;
      this.expected = expected;
      this.found = found;
      this.location = location;
      this.name = "SyntaxError";
      if (typeof Error.captureStackTrace === "function") {
        Error.captureStackTrace(this, peg$SyntaxError);
      }
    }
    peg$subclass(peg$SyntaxError, Error);
    peg$SyntaxError.buildMessage = function(expected, found, location) {
      var DESCRIBE_EXPECTATION_FNS = {
        literal: function(expectation) {
          return '"' + literalEscape(expectation.text) + '"';
        },
        class: function(expectation) {
          var escapedParts = expectation.parts.map(function(part) {
            return Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part);
          });
          return "[" + (expectation.inverted ? "^" : "") + escapedParts + "]";
        },
        any: function() {
          return "any character";
        },
        end: function() {
          return "end of input";
        },
        other: function(expectation) {
          return expectation.description;
        },
        not: function(expectation) {
          return "not " + describeExpectation(expectation.expected);
        }
      };
      function hex(ch) {
        return ch.charCodeAt(0).toString(16).toUpperCase();
      }
      function literalEscape(s2) {
        return s2.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, function(ch) {
          return "\\x0" + hex(ch);
        }).replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) {
          return "\\x" + hex(ch);
        });
      }
      function classEscape(s2) {
        return s2.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, function(ch) {
          return "\\x0" + hex(ch);
        }).replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) {
          return "\\x" + hex(ch);
        });
      }
      function describeExpectation(expectation) {
        return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
      }
      function describeExpected(expected2) {
        var descriptions = expected2.map(describeExpectation);
        var i, j;
        descriptions.sort();
        if (descriptions.length > 0) {
          for (i = 1, j = 1; i < descriptions.length; i++) {
            if (descriptions[i - 1] !== descriptions[i]) {
              descriptions[j] = descriptions[i];
              j++;
            }
          }
          descriptions.length = j;
        }
        switch (descriptions.length) {
          case 1:
            return descriptions[0];
          case 2:
            return descriptions[0] + " or " + descriptions[1];
          default:
            return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
        }
      }
      function describeFound(found2) {
        return found2 ? '"' + literalEscape(found2) + '"' : "end of input";
      }
      return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
    };
    function peg$parse(input, options) {
      options = options !== void 0 ? options : {};
      var peg$FAILED = {};
      var peg$startRuleFunctions = { Top: peg$parseTop };
      var peg$startRuleFunction = peg$parseTop;
      var peg$c0 = "/";
      var peg$c1 = ".";
      var peg$c2 = "#";
      var peg$c3 = "=";
      var peg$c4 = "(";
      var peg$c5 = ")";
      var peg$c6 = ",";
      var peg$c7 = "[";
      var peg$c8 = "]";
      var peg$c9 = "null";
      var peg$c10 = "true";
      var peg$c11 = "false";
      var peg$c12 = "{";
      var peg$c13 = "}";
      var peg$c14 = ":";
      var peg$c16 = '"';
      var peg$c17 = "\\";
      var peg$c18 = "n";
      var peg$c19 = "r";
      var peg$c20 = "t";
      var peg$r0 = /^[$@]/;
      var peg$r1 = /^[0-9]/;
      var peg$r2 = /^[^\0-\x1F"\\]/;
      var peg$r3 = /^[a-zA-Z0-9_\-]/;
      var peg$r4 = /^[ \n\t]/;
      var peg$e0 = peg$literalExpectation("/", false);
      var peg$e1 = peg$otherExpectation("tag name");
      var peg$e2 = peg$otherExpectation("class");
      var peg$e3 = peg$otherExpectation("id");
      var peg$e4 = peg$literalExpectation("=", false);
      var peg$e5 = peg$literalExpectation("(", false);
      var peg$e6 = peg$literalExpectation(")", false);
      var peg$e7 = peg$literalExpectation(",", false);
      var peg$e8 = peg$otherExpectation("variable");
      var peg$e9 = peg$otherExpectation("null");
      var peg$e10 = peg$otherExpectation("boolean");
      var peg$e11 = peg$literalExpectation("[", false);
      var peg$e12 = peg$literalExpectation("]", false);
      var peg$e13 = peg$literalExpectation("{", false);
      var peg$e14 = peg$literalExpectation("}", false);
      var peg$e15 = peg$literalExpectation(":", false);
      var peg$e16 = peg$otherExpectation("number");
      var peg$e17 = peg$otherExpectation("string");
      var peg$e18 = peg$otherExpectation("identifier");
      var peg$e19 = peg$otherExpectation("whitespace");
      var peg$f0 = function(variable) {
        return { type: "variable", meta: { variable } };
      };
      var peg$f1 = function(attributes) {
        return { type: "annotation", meta: { attributes } };
      };
      var peg$f2 = function(tag, value) {
        return value;
      };
      var peg$f3 = function(tag, primary, attributes, close) {
        if (primary) {
          attributes = attributes || [];
          attributes.unshift({
            type: "attribute",
            name: "primary",
            value: primary
          });
        }
        const [type, nesting] = close ? ["tag", 0] : ["tag_open", 1];
        return { type, nesting, meta: { tag, attributes } };
      };
      var peg$f4 = function(tag) {
        return { type: "tag_close", nesting: -1, meta: { tag } };
      };
      var peg$f5 = function(head, tail) {
        return !head ? [] : [head, ...tail];
      };
      var peg$f6 = function(item2) {
        return item2;
      };
      var peg$f7 = function(ids) {
        return ids;
      };
      var peg$f8 = function(classes) {
        return classes;
      };
      var peg$f9 = function(attribute) {
        return attribute;
      };
      var peg$f10 = function(name) {
        return { type: "class", name, value: true };
      };
      var peg$f11 = function(value) {
        return { type: "attribute", name: "id", value };
      };
      var peg$f12 = function(name, value) {
        return { type: "attribute", name, value };
      };
      var peg$f13 = function(name, head, tail) {
        return head ? [head, ...tail] : [];
      };
      var peg$f14 = function(name, params) {
        let parameters = {};
        for (let [index, { name: name2, value }] of params.entries())
          parameters[name2 || index] = value;
        return new Function3(name, parameters);
      };
      var peg$f15 = function(name) {
        return name;
      };
      var peg$f16 = function(name, value) {
        return { name, value };
      };
      var peg$f17 = function(value) {
        return value;
      };
      var peg$f18 = function(prefix, head, tail) {
        if (prefix === "@")
          return [head, ...tail];
        return new Variable2([head, ...tail]);
      };
      var peg$f19 = function() {
        return null;
      };
      var peg$f20 = function() {
        return true;
      };
      var peg$f21 = function() {
        return false;
      };
      var peg$f22 = function(head, tail) {
        return [head, ...tail];
      };
      var peg$f23 = function(value) {
        return value || [];
      };
      var peg$f24 = function(head, tail) {
        return Object.assign(head, ...tail);
      };
      var peg$f25 = function(value) {
        return value || {};
      };
      var peg$f26 = function(key, value) {
        return key === "$$mdtype" ? {} : { [key]: value };
      };
      var peg$f27 = function() {
        return parseFloat(text2());
      };
      var peg$f28 = function(value) {
        return value.join("");
      };
      var peg$f29 = function() {
        return "\n";
      };
      var peg$f30 = function() {
        return "\r";
      };
      var peg$f31 = function() {
        return "	";
      };
      var peg$f32 = function(sequence) {
        return sequence;
      };
      var peg$currPos = 0;
      var peg$savedPos = 0;
      var peg$posDetailsCache = [{ line: 1, column: 1 }];
      var peg$expected = [];
      var peg$silentFails = 0;
      var peg$result;
      if ("startRule" in options) {
        if (!(options.startRule in peg$startRuleFunctions)) {
          throw new Error(`Can't start parsing from rule "` + options.startRule + '".');
        }
        peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
      }
      function text2() {
        return input.substring(peg$savedPos, peg$currPos);
      }
      function peg$literalExpectation(text3, ignoreCase) {
        return { type: "literal", text: text3, ignoreCase };
      }
      function peg$endExpectation() {
        return { type: "end" };
      }
      function peg$otherExpectation(description) {
        return { type: "other", description };
      }
      function peg$computePosDetails(pos) {
        var details = peg$posDetailsCache[pos];
        var p;
        if (details) {
          return details;
        } else {
          p = pos - 1;
          while (!peg$posDetailsCache[p]) {
            p--;
          }
          details = peg$posDetailsCache[p];
          details = {
            line: details.line,
            column: details.column
          };
          while (p < pos) {
            if (input.charCodeAt(p) === 10) {
              details.line++;
              details.column = 1;
            } else {
              details.column++;
            }
            p++;
          }
          peg$posDetailsCache[pos] = details;
          return details;
        }
      }
      var peg$VALIDFILENAME = typeof options.filename === "string" && options.filename.length > 0;
      function peg$computeLocation(startPos, endPos) {
        var loc = {};
        if (peg$VALIDFILENAME)
          loc.filename = options.filename;
        var startPosDetails = peg$computePosDetails(startPos);
        loc.start = {
          offset: startPos,
          line: startPosDetails.line,
          column: startPosDetails.column
        };
        var endPosDetails = peg$computePosDetails(endPos);
        loc.end = {
          offset: endPos,
          line: endPosDetails.line,
          column: endPosDetails.column
        };
        return loc;
      }
      function peg$begin() {
        peg$expected.push({ pos: peg$currPos, variants: [] });
      }
      function peg$expect(expected2) {
        var top = peg$expected[peg$expected.length - 1];
        if (peg$currPos < top.pos) {
          return;
        }
        if (peg$currPos > top.pos) {
          top.pos = peg$currPos;
          top.variants = [];
        }
        top.variants.push(expected2);
      }
      function peg$buildStructuredError(expected2, found, location2) {
        return new peg$SyntaxError(peg$SyntaxError.buildMessage(expected2, found, location2), expected2, found, location2);
      }
      function peg$buildError() {
        var expected2 = peg$expected[0];
        var failPos = expected2.pos;
        return peg$buildStructuredError(expected2.variants, failPos < input.length ? input.charAt(failPos) : null, failPos < input.length ? peg$computeLocation(failPos, failPos + 1) : peg$computeLocation(failPos, failPos));
      }
      function peg$parseTop() {
        var s0;
        s0 = peg$parseTopLevelValue();
        if (s0 === peg$FAILED) {
          s0 = peg$parseAnnotation();
          if (s0 === peg$FAILED) {
            s0 = peg$parseTagOpen();
            if (s0 === peg$FAILED) {
              s0 = peg$parseTagClose();
            }
          }
        }
        return s0;
      }
      function peg$parseTopLevelValue() {
        var s0, s1;
        s0 = peg$currPos;
        s1 = peg$parseVariable();
        if (s1 === peg$FAILED) {
          s1 = peg$parseFunction();
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$f0(s1);
        }
        s0 = s1;
        return s0;
      }
      function peg$parseAnnotation() {
        var s0, s1, s2, s3;
        s0 = peg$currPos;
        s1 = peg$parseTagAttributes();
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parse_();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parse_();
          }
          peg$savedPos = s0;
          s0 = peg$f1(s1);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseTagOpen() {
        var s0, s1, s2, s3, s4, s5, s6;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        s1 = peg$parseTagName();
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parse_();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parse_();
          }
          s3 = peg$currPos;
          s4 = peg$parseValue();
          if (s4 !== peg$FAILED) {
            s5 = peg$parse_();
            if (s5 === peg$FAILED) {
              s5 = null;
            }
            peg$savedPos = s3;
            s3 = peg$f2(s1, s4);
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
          if (s3 === peg$FAILED) {
            s3 = null;
          }
          s4 = peg$parseTagAttributes();
          if (s4 === peg$FAILED) {
            s4 = null;
          }
          s5 = [];
          s6 = peg$parse_();
          while (s6 !== peg$FAILED) {
            s5.push(s6);
            s6 = peg$parse_();
          }
          rule$expects(peg$e0);
          if (input.charCodeAt(peg$currPos) === 47) {
            s6 = peg$c0;
            peg$currPos++;
          } else {
            s6 = peg$FAILED;
          }
          if (s6 === peg$FAILED) {
            s6 = null;
          }
          peg$savedPos = s0;
          s0 = peg$f3(s1, s3, s4, s6);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseTagClose() {
        var s0, s1, s2;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        rule$expects(peg$e0);
        if (input.charCodeAt(peg$currPos) === 47) {
          s1 = peg$c0;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parseTagName();
          if (s2 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f4(s2);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseTagName() {
        var s0;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e1);
        peg$silentFails++;
        s0 = peg$parseIdentifier();
        peg$silentFails--;
        return s0;
      }
      function peg$parseTagAttributes() {
        var s0, s1, s2, s3;
        s0 = peg$currPos;
        s1 = peg$parseTagAttributesItem();
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parseTagAttributesTail();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parseTagAttributesTail();
          }
          peg$savedPos = s0;
          s0 = peg$f5(s1, s2);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseTagAttributesTail() {
        var s0, s1, s2;
        s0 = peg$currPos;
        s1 = [];
        s2 = peg$parse_();
        if (s2 !== peg$FAILED) {
          while (s2 !== peg$FAILED) {
            s1.push(s2);
            s2 = peg$parse_();
          }
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parseTagAttributesItem();
          if (s2 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f6(s2);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseTagAttributesItem() {
        var s0, s1;
        s0 = peg$currPos;
        s1 = peg$parseTagShortcutId();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$f7(s1);
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseTagShortcutClass();
          if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$f8(s1);
          }
          s0 = s1;
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parseTagAttribute();
            if (s1 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$f9(s1);
            }
            s0 = s1;
          }
        }
        return s0;
      }
      function peg$parseTagShortcutClass() {
        var s0, s1, s2;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e2);
        peg$silentFails++;
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 46) {
          s1 = peg$c1;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parseIdentifier();
          if (s2 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f10(s2);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        peg$silentFails--;
        return s0;
      }
      function peg$parseTagShortcutId() {
        var s0, s1, s2;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e3);
        peg$silentFails++;
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 35) {
          s1 = peg$c2;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parseIdentifier();
          if (s2 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f11(s2);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        peg$silentFails--;
        return s0;
      }
      function peg$parseTagAttribute() {
        var s0, s1, s2, s3;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        s1 = peg$parseIdentifier();
        if (s1 !== peg$FAILED) {
          rule$expects(peg$e4);
          if (input.charCodeAt(peg$currPos) === 61) {
            s2 = peg$c3;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
          }
          if (s2 !== peg$FAILED) {
            s3 = peg$parseValue();
            if (s3 !== peg$FAILED) {
              peg$savedPos = s0;
              s0 = peg$f12(s1, s3);
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseFunction() {
        var s0, s1, s2, s3, s4, s5, s6, s7;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        s1 = peg$parseIdentifier();
        if (s1 !== peg$FAILED) {
          rule$expects(peg$e5);
          if (input.charCodeAt(peg$currPos) === 40) {
            s2 = peg$c4;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
          }
          if (s2 !== peg$FAILED) {
            s3 = [];
            s4 = peg$parse_();
            while (s4 !== peg$FAILED) {
              s3.push(s4);
              s4 = peg$parse_();
            }
            s4 = peg$currPos;
            s5 = peg$parseFunctionParameter();
            if (s5 === peg$FAILED) {
              s5 = null;
            }
            s6 = [];
            s7 = peg$parseFunctionParameterTail();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseFunctionParameterTail();
            }
            peg$savedPos = s4;
            s4 = peg$f13(s1, s5, s6);
            rule$expects(peg$e6);
            if (input.charCodeAt(peg$currPos) === 41) {
              s5 = peg$c5;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s0 = peg$f14(s1, s4);
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseFunctionParameter() {
        var s0, s1, s2, s3;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        s1 = peg$currPos;
        s2 = peg$parseIdentifier();
        if (s2 !== peg$FAILED) {
          rule$expects(peg$e4);
          if (input.charCodeAt(peg$currPos) === 61) {
            s3 = peg$c3;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s1;
            s1 = peg$f15(s2);
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
        if (s1 === peg$FAILED) {
          s1 = null;
        }
        s2 = peg$parseValue();
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s0 = peg$f16(s1, s2);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseFunctionParameterTail() {
        var s0, s1, s2, s3, s4;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        s1 = [];
        s2 = peg$parse_();
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$parse_();
        }
        rule$expects(peg$e7);
        if (input.charCodeAt(peg$currPos) === 44) {
          s2 = peg$c6;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parse_();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parse_();
          }
          s4 = peg$parseFunctionParameter();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f17(s4);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseTrailingComma() {
        var s0, s1, s2;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        s1 = [];
        s2 = peg$parse_();
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$parse_();
        }
        rule$expects(peg$e7);
        if (input.charCodeAt(peg$currPos) === 44) {
          s2 = peg$c6;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          s1 = [s1, s2];
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = null;
        }
        return s0;
      }
      function peg$parseVariable() {
        var s0, s1, s2, s3, s4;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e8);
        peg$silentFails++;
        s0 = peg$currPos;
        if (peg$r0.test(input.charAt(peg$currPos))) {
          s1 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parseIdentifier();
          if (s2 !== peg$FAILED) {
            s3 = [];
            s4 = peg$parseVariableTail();
            while (s4 !== peg$FAILED) {
              s3.push(s4);
              s4 = peg$parseVariableTail();
            }
            peg$savedPos = s0;
            s0 = peg$f18(s1, s2, s3);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        peg$silentFails--;
        return s0;
      }
      function peg$parseVariableTail() {
        var s0, s1, s2, s3;
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 46) {
          s1 = peg$c1;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parseIdentifier();
          if (s2 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f15(s2);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 91) {
            s1 = peg$c7;
            peg$currPos++;
          } else {
            s1 = peg$FAILED;
          }
          if (s1 !== peg$FAILED) {
            s2 = peg$parseValueNumber();
            if (s2 === peg$FAILED) {
              s2 = peg$parseValueString();
            }
            if (s2 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 93) {
                s3 = peg$c8;
                peg$currPos++;
              } else {
                s3 = peg$FAILED;
              }
              if (s3 !== peg$FAILED) {
                peg$savedPos = s0;
                s0 = peg$f17(s2);
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        }
        return s0;
      }
      function peg$parseValue() {
        var s0;
        s0 = peg$parseValueNull();
        if (s0 === peg$FAILED) {
          s0 = peg$parseValueBoolean();
          if (s0 === peg$FAILED) {
            s0 = peg$parseValueString();
            if (s0 === peg$FAILED) {
              s0 = peg$parseValueNumber();
              if (s0 === peg$FAILED) {
                s0 = peg$parseValueArray();
                if (s0 === peg$FAILED) {
                  s0 = peg$parseValueHash();
                  if (s0 === peg$FAILED) {
                    s0 = peg$parseFunction();
                    if (s0 === peg$FAILED) {
                      s0 = peg$parseVariable();
                    }
                  }
                }
              }
            }
          }
        }
        return s0;
      }
      function peg$parseValueNull() {
        var s0, s1;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e9);
        peg$silentFails++;
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 4) === peg$c9) {
          s1 = peg$c9;
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$f19();
        }
        s0 = s1;
        peg$silentFails--;
        return s0;
      }
      function peg$parseValueBoolean() {
        var s0, s1;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e10);
        peg$silentFails++;
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 4) === peg$c10) {
          s1 = peg$c10;
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$f20();
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.substr(peg$currPos, 5) === peg$c11) {
            s1 = peg$c11;
            peg$currPos += 5;
          } else {
            s1 = peg$FAILED;
          }
          if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$f21();
          }
          s0 = s1;
        }
        peg$silentFails--;
        return s0;
      }
      function peg$parseValueArray() {
        var s0, s1, s2, s3, s4, s5, s6;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        rule$expects(peg$e11);
        if (input.charCodeAt(peg$currPos) === 91) {
          s1 = peg$c7;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parse_();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parse_();
          }
          s3 = peg$currPos;
          s4 = peg$parseValue();
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseValueArrayTail();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseValueArrayTail();
            }
            s6 = peg$parseTrailingComma();
            peg$savedPos = s3;
            s3 = peg$f22(s4, s5);
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
          if (s3 === peg$FAILED) {
            s3 = null;
          }
          s4 = [];
          s5 = peg$parse_();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parse_();
          }
          rule$expects(peg$e12);
          if (input.charCodeAt(peg$currPos) === 93) {
            s5 = peg$c8;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f23(s3);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseValueArrayTail() {
        var s0, s1, s2, s3, s4;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        s1 = [];
        s2 = peg$parse_();
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$parse_();
        }
        rule$expects(peg$e7);
        if (input.charCodeAt(peg$currPos) === 44) {
          s2 = peg$c6;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parse_();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parse_();
          }
          s4 = peg$parseValue();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f17(s4);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseValueHash() {
        var s0, s1, s2, s3, s4, s5, s6;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        rule$expects(peg$e13);
        if (input.charCodeAt(peg$currPos) === 123) {
          s1 = peg$c12;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parse_();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parse_();
          }
          s3 = peg$currPos;
          s4 = peg$parseValueHashItem();
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseValueHashTail();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseValueHashTail();
            }
            s6 = peg$parseTrailingComma();
            peg$savedPos = s3;
            s3 = peg$f24(s4, s5);
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
          if (s3 === peg$FAILED) {
            s3 = null;
          }
          s4 = [];
          s5 = peg$parse_();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parse_();
          }
          rule$expects(peg$e14);
          if (input.charCodeAt(peg$currPos) === 125) {
            s5 = peg$c13;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f25(s3);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseValueHashTail() {
        var s0, s1, s2, s3, s4;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        s1 = [];
        s2 = peg$parse_();
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$parse_();
        }
        rule$expects(peg$e7);
        if (input.charCodeAt(peg$currPos) === 44) {
          s2 = peg$c6;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parse_();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parse_();
          }
          s4 = peg$parseValueHashItem();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f6(s4);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseValueHashItem() {
        var s0, s1, s2, s3, s4;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        s0 = peg$currPos;
        s1 = peg$parseIdentifier();
        if (s1 === peg$FAILED) {
          s1 = peg$parseValueString();
        }
        if (s1 !== peg$FAILED) {
          rule$expects(peg$e15);
          if (input.charCodeAt(peg$currPos) === 58) {
            s2 = peg$c14;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
          }
          if (s2 !== peg$FAILED) {
            s3 = [];
            s4 = peg$parse_();
            while (s4 !== peg$FAILED) {
              s3.push(s4);
              s4 = peg$parse_();
            }
            s4 = peg$parseValue();
            if (s4 !== peg$FAILED) {
              peg$savedPos = s0;
              s0 = peg$f26(s1, s4);
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseValueNumber() {
        var s0, s2, s3, s4, s5, s6;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e16);
        peg$silentFails++;
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 45) {
          peg$currPos++;
        }
        s2 = [];
        if (peg$r1.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            if (peg$r1.test(input.charAt(peg$currPos))) {
              s3 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
            }
          }
        } else {
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 46) {
            s4 = peg$c1;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            if (peg$r1.test(input.charAt(peg$currPos))) {
              s6 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s6 = peg$FAILED;
            }
            if (s6 !== peg$FAILED) {
              while (s6 !== peg$FAILED) {
                s5.push(s6);
                if (peg$r1.test(input.charAt(peg$currPos))) {
                  s6 = input.charAt(peg$currPos);
                  peg$currPos++;
                } else {
                  s6 = peg$FAILED;
                }
              }
            } else {
              s5 = peg$FAILED;
            }
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
          if (s3 === peg$FAILED) {
            s3 = null;
          }
          peg$savedPos = s0;
          s0 = peg$f27();
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        peg$silentFails--;
        return s0;
      }
      function peg$parseValueString() {
        var s0, s1, s2, s3;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e17);
        peg$silentFails++;
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 34) {
          s1 = peg$c16;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parseValueStringChars();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parseValueStringChars();
          }
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c16;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f28(s2);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        peg$silentFails--;
        return s0;
      }
      function peg$parseValueStringChars() {
        var s0;
        if (peg$r2.test(input.charAt(peg$currPos))) {
          s0 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$parseValueStringEscapes();
        }
        return s0;
      }
      function peg$parseValueStringEscapes() {
        var s0, s1, s2, s3;
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 92) {
          s1 = peg$c17;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s2 = peg$c16;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
          }
          if (s2 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 92) {
              s2 = peg$c17;
              peg$currPos++;
            } else {
              s2 = peg$FAILED;
            }
            if (s2 === peg$FAILED) {
              s2 = peg$currPos;
              if (input.charCodeAt(peg$currPos) === 110) {
                s3 = peg$c18;
                peg$currPos++;
              } else {
                s3 = peg$FAILED;
              }
              if (s3 !== peg$FAILED) {
                peg$savedPos = s2;
                s3 = peg$f29();
              }
              s2 = s3;
              if (s2 === peg$FAILED) {
                s2 = peg$currPos;
                if (input.charCodeAt(peg$currPos) === 114) {
                  s3 = peg$c19;
                  peg$currPos++;
                } else {
                  s3 = peg$FAILED;
                }
                if (s3 !== peg$FAILED) {
                  peg$savedPos = s2;
                  s3 = peg$f30();
                }
                s2 = s3;
                if (s2 === peg$FAILED) {
                  s2 = peg$currPos;
                  if (input.charCodeAt(peg$currPos) === 116) {
                    s3 = peg$c20;
                    peg$currPos++;
                  } else {
                    s3 = peg$FAILED;
                  }
                  if (s3 !== peg$FAILED) {
                    peg$savedPos = s2;
                    s3 = peg$f31();
                  }
                  s2 = s3;
                }
              }
            }
          }
          if (s2 !== peg$FAILED) {
            peg$savedPos = s0;
            s0 = peg$f32(s2);
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        return s0;
      }
      function peg$parseIdentifier() {
        var s0, s1, s2;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e18);
        peg$silentFails++;
        s0 = peg$currPos;
        s1 = [];
        if (peg$r3.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          while (s2 !== peg$FAILED) {
            s1.push(s2);
            if (peg$r3.test(input.charAt(peg$currPos))) {
              s2 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s2 = peg$FAILED;
            }
          }
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s0 = input.substring(s0, peg$currPos);
        } else {
          s0 = s1;
        }
        peg$silentFails--;
        return s0;
      }
      function peg$parse_() {
        var s0;
        var rule$expects = function(expected2) {
          if (peg$silentFails === 0)
            peg$expect(expected2);
        };
        rule$expects(peg$e19);
        peg$silentFails++;
        if (peg$r4.test(input.charAt(peg$currPos))) {
          s0 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
        }
        peg$silentFails--;
        return s0;
      }
      const { Variable: Variable2, Function: Function3 } = options;
      peg$begin();
      peg$result = peg$startRuleFunction();
      if (peg$result !== peg$FAILED && peg$currPos === input.length) {
        return peg$result;
      } else {
        if (peg$result !== peg$FAILED && peg$currPos < input.length) {
          peg$expect(peg$endExpectation());
        }
        throw peg$buildError();
      }
    }
    module.exports = {
      SyntaxError: peg$SyntaxError,
      parse: peg$parse
    };
  }
});

// node_modules/entities/lib/maps/entities.json
var require_entities = __commonJS({
  "node_modules/entities/lib/maps/entities.json"(exports, module) {
    module.exports = { Aacute: "\xC1", aacute: "\xE1", Abreve: "\u0102", abreve: "\u0103", ac: "\u223E", acd: "\u223F", acE: "\u223E\u0333", Acirc: "\xC2", acirc: "\xE2", acute: "\xB4", Acy: "\u0410", acy: "\u0430", AElig: "\xC6", aelig: "\xE6", af: "\u2061", Afr: "\u{1D504}", afr: "\u{1D51E}", Agrave: "\xC0", agrave: "\xE0", alefsym: "\u2135", aleph: "\u2135", Alpha: "\u0391", alpha: "\u03B1", Amacr: "\u0100", amacr: "\u0101", amalg: "\u2A3F", amp: "&", AMP: "&", andand: "\u2A55", And: "\u2A53", and: "\u2227", andd: "\u2A5C", andslope: "\u2A58", andv: "\u2A5A", ang: "\u2220", ange: "\u29A4", angle: "\u2220", angmsdaa: "\u29A8", angmsdab: "\u29A9", angmsdac: "\u29AA", angmsdad: "\u29AB", angmsdae: "\u29AC", angmsdaf: "\u29AD", angmsdag: "\u29AE", angmsdah: "\u29AF", angmsd: "\u2221", angrt: "\u221F", angrtvb: "\u22BE", angrtvbd: "\u299D", angsph: "\u2222", angst: "\xC5", angzarr: "\u237C", Aogon: "\u0104", aogon: "\u0105", Aopf: "\u{1D538}", aopf: "\u{1D552}", apacir: "\u2A6F", ap: "\u2248", apE: "\u2A70", ape: "\u224A", apid: "\u224B", apos: "'", ApplyFunction: "\u2061", approx: "\u2248", approxeq: "\u224A", Aring: "\xC5", aring: "\xE5", Ascr: "\u{1D49C}", ascr: "\u{1D4B6}", Assign: "\u2254", ast: "*", asymp: "\u2248", asympeq: "\u224D", Atilde: "\xC3", atilde: "\xE3", Auml: "\xC4", auml: "\xE4", awconint: "\u2233", awint: "\u2A11", backcong: "\u224C", backepsilon: "\u03F6", backprime: "\u2035", backsim: "\u223D", backsimeq: "\u22CD", Backslash: "\u2216", Barv: "\u2AE7", barvee: "\u22BD", barwed: "\u2305", Barwed: "\u2306", barwedge: "\u2305", bbrk: "\u23B5", bbrktbrk: "\u23B6", bcong: "\u224C", Bcy: "\u0411", bcy: "\u0431", bdquo: "\u201E", becaus: "\u2235", because: "\u2235", Because: "\u2235", bemptyv: "\u29B0", bepsi: "\u03F6", bernou: "\u212C", Bernoullis: "\u212C", Beta: "\u0392", beta: "\u03B2", beth: "\u2136", between: "\u226C", Bfr: "\u{1D505}", bfr: "\u{1D51F}", bigcap: "\u22C2", bigcirc: "\u25EF", bigcup: "\u22C3", bigodot: "\u2A00", bigoplus: "\u2A01", bigotimes: "\u2A02", bigsqcup: "\u2A06", bigstar: "\u2605", bigtriangledown: "\u25BD", bigtriangleup: "\u25B3", biguplus: "\u2A04", bigvee: "\u22C1", bigwedge: "\u22C0", bkarow: "\u290D", blacklozenge: "\u29EB", blacksquare: "\u25AA", blacktriangle: "\u25B4", blacktriangledown: "\u25BE", blacktriangleleft: "\u25C2", blacktriangleright: "\u25B8", blank: "\u2423", blk12: "\u2592", blk14: "\u2591", blk34: "\u2593", block: "\u2588", bne: "=\u20E5", bnequiv: "\u2261\u20E5", bNot: "\u2AED", bnot: "\u2310", Bopf: "\u{1D539}", bopf: "\u{1D553}", bot: "\u22A5", bottom: "\u22A5", bowtie: "\u22C8", boxbox: "\u29C9", boxdl: "\u2510", boxdL: "\u2555", boxDl: "\u2556", boxDL: "\u2557", boxdr: "\u250C", boxdR: "\u2552", boxDr: "\u2553", boxDR: "\u2554", boxh: "\u2500", boxH: "\u2550", boxhd: "\u252C", boxHd: "\u2564", boxhD: "\u2565", boxHD: "\u2566", boxhu: "\u2534", boxHu: "\u2567", boxhU: "\u2568", boxHU: "\u2569", boxminus: "\u229F", boxplus: "\u229E", boxtimes: "\u22A0", boxul: "\u2518", boxuL: "\u255B", boxUl: "\u255C", boxUL: "\u255D", boxur: "\u2514", boxuR: "\u2558", boxUr: "\u2559", boxUR: "\u255A", boxv: "\u2502", boxV: "\u2551", boxvh: "\u253C", boxvH: "\u256A", boxVh: "\u256B", boxVH: "\u256C", boxvl: "\u2524", boxvL: "\u2561", boxVl: "\u2562", boxVL: "\u2563", boxvr: "\u251C", boxvR: "\u255E", boxVr: "\u255F", boxVR: "\u2560", bprime: "\u2035", breve: "\u02D8", Breve: "\u02D8", brvbar: "\xA6", bscr: "\u{1D4B7}", Bscr: "\u212C", bsemi: "\u204F", bsim: "\u223D", bsime: "\u22CD", bsolb: "\u29C5", bsol: "\\", bsolhsub: "\u27C8", bull: "\u2022", bullet: "\u2022", bump: "\u224E", bumpE: "\u2AAE", bumpe: "\u224F", Bumpeq: "\u224E", bumpeq: "\u224F", Cacute: "\u0106", cacute: "\u0107", capand: "\u2A44", capbrcup: "\u2A49", capcap: "\u2A4B", cap: "\u2229", Cap: "\u22D2", capcup: "\u2A47", capdot: "\u2A40", CapitalDifferentialD: "\u2145", caps: "\u2229\uFE00", caret: "\u2041", caron: "\u02C7", Cayleys: "\u212D", ccaps: "\u2A4D", Ccaron: "\u010C", ccaron: "\u010D", Ccedil: "\xC7", ccedil: "\xE7", Ccirc: "\u0108", ccirc: "\u0109", Cconint: "\u2230", ccups: "\u2A4C", ccupssm: "\u2A50", Cdot: "\u010A", cdot: "\u010B", cedil: "\xB8", Cedilla: "\xB8", cemptyv: "\u29B2", cent: "\xA2", centerdot: "\xB7", CenterDot: "\xB7", cfr: "\u{1D520}", Cfr: "\u212D", CHcy: "\u0427", chcy: "\u0447", check: "\u2713", checkmark: "\u2713", Chi: "\u03A7", chi: "\u03C7", circ: "\u02C6", circeq: "\u2257", circlearrowleft: "\u21BA", circlearrowright: "\u21BB", circledast: "\u229B", circledcirc: "\u229A", circleddash: "\u229D", CircleDot: "\u2299", circledR: "\xAE", circledS: "\u24C8", CircleMinus: "\u2296", CirclePlus: "\u2295", CircleTimes: "\u2297", cir: "\u25CB", cirE: "\u29C3", cire: "\u2257", cirfnint: "\u2A10", cirmid: "\u2AEF", cirscir: "\u29C2", ClockwiseContourIntegral: "\u2232", CloseCurlyDoubleQuote: "\u201D", CloseCurlyQuote: "\u2019", clubs: "\u2663", clubsuit: "\u2663", colon: ":", Colon: "\u2237", Colone: "\u2A74", colone: "\u2254", coloneq: "\u2254", comma: ",", commat: "@", comp: "\u2201", compfn: "\u2218", complement: "\u2201", complexes: "\u2102", cong: "\u2245", congdot: "\u2A6D", Congruent: "\u2261", conint: "\u222E", Conint: "\u222F", ContourIntegral: "\u222E", copf: "\u{1D554}", Copf: "\u2102", coprod: "\u2210", Coproduct: "\u2210", copy: "\xA9", COPY: "\xA9", copysr: "\u2117", CounterClockwiseContourIntegral: "\u2233", crarr: "\u21B5", cross: "\u2717", Cross: "\u2A2F", Cscr: "\u{1D49E}", cscr: "\u{1D4B8}", csub: "\u2ACF", csube: "\u2AD1", csup: "\u2AD0", csupe: "\u2AD2", ctdot: "\u22EF", cudarrl: "\u2938", cudarrr: "\u2935", cuepr: "\u22DE", cuesc: "\u22DF", cularr: "\u21B6", cularrp: "\u293D", cupbrcap: "\u2A48", cupcap: "\u2A46", CupCap: "\u224D", cup: "\u222A", Cup: "\u22D3", cupcup: "\u2A4A", cupdot: "\u228D", cupor: "\u2A45", cups: "\u222A\uFE00", curarr: "\u21B7", curarrm: "\u293C", curlyeqprec: "\u22DE", curlyeqsucc: "\u22DF", curlyvee: "\u22CE", curlywedge: "\u22CF", curren: "\xA4", curvearrowleft: "\u21B6", curvearrowright: "\u21B7", cuvee: "\u22CE", cuwed: "\u22CF", cwconint: "\u2232", cwint: "\u2231", cylcty: "\u232D", dagger: "\u2020", Dagger: "\u2021", daleth: "\u2138", darr: "\u2193", Darr: "\u21A1", dArr: "\u21D3", dash: "\u2010", Dashv: "\u2AE4", dashv: "\u22A3", dbkarow: "\u290F", dblac: "\u02DD", Dcaron: "\u010E", dcaron: "\u010F", Dcy: "\u0414", dcy: "\u0434", ddagger: "\u2021", ddarr: "\u21CA", DD: "\u2145", dd: "\u2146", DDotrahd: "\u2911", ddotseq: "\u2A77", deg: "\xB0", Del: "\u2207", Delta: "\u0394", delta: "\u03B4", demptyv: "\u29B1", dfisht: "\u297F", Dfr: "\u{1D507}", dfr: "\u{1D521}", dHar: "\u2965", dharl: "\u21C3", dharr: "\u21C2", DiacriticalAcute: "\xB4", DiacriticalDot: "\u02D9", DiacriticalDoubleAcute: "\u02DD", DiacriticalGrave: "`", DiacriticalTilde: "\u02DC", diam: "\u22C4", diamond: "\u22C4", Diamond: "\u22C4", diamondsuit: "\u2666", diams: "\u2666", die: "\xA8", DifferentialD: "\u2146", digamma: "\u03DD", disin: "\u22F2", div: "\xF7", divide: "\xF7", divideontimes: "\u22C7", divonx: "\u22C7", DJcy: "\u0402", djcy: "\u0452", dlcorn: "\u231E", dlcrop: "\u230D", dollar: "$", Dopf: "\u{1D53B}", dopf: "\u{1D555}", Dot: "\xA8", dot: "\u02D9", DotDot: "\u20DC", doteq: "\u2250", doteqdot: "\u2251", DotEqual: "\u2250", dotminus: "\u2238", dotplus: "\u2214", dotsquare: "\u22A1", doublebarwedge: "\u2306", DoubleContourIntegral: "\u222F", DoubleDot: "\xA8", DoubleDownArrow: "\u21D3", DoubleLeftArrow: "\u21D0", DoubleLeftRightArrow: "\u21D4", DoubleLeftTee: "\u2AE4", DoubleLongLeftArrow: "\u27F8", DoubleLongLeftRightArrow: "\u27FA", DoubleLongRightArrow: "\u27F9", DoubleRightArrow: "\u21D2", DoubleRightTee: "\u22A8", DoubleUpArrow: "\u21D1", DoubleUpDownArrow: "\u21D5", DoubleVerticalBar: "\u2225", DownArrowBar: "\u2913", downarrow: "\u2193", DownArrow: "\u2193", Downarrow: "\u21D3", DownArrowUpArrow: "\u21F5", DownBreve: "\u0311", downdownarrows: "\u21CA", downharpoonleft: "\u21C3", downharpoonright: "\u21C2", DownLeftRightVector: "\u2950", DownLeftTeeVector: "\u295E", DownLeftVectorBar: "\u2956", DownLeftVector: "\u21BD", DownRightTeeVector: "\u295F", DownRightVectorBar: "\u2957", DownRightVector: "\u21C1", DownTeeArrow: "\u21A7", DownTee: "\u22A4", drbkarow: "\u2910", drcorn: "\u231F", drcrop: "\u230C", Dscr: "\u{1D49F}", dscr: "\u{1D4B9}", DScy: "\u0405", dscy: "\u0455", dsol: "\u29F6", Dstrok: "\u0110", dstrok: "\u0111", dtdot: "\u22F1", dtri: "\u25BF", dtrif: "\u25BE", duarr: "\u21F5", duhar: "\u296F", dwangle: "\u29A6", DZcy: "\u040F", dzcy: "\u045F", dzigrarr: "\u27FF", Eacute: "\xC9", eacute: "\xE9", easter: "\u2A6E", Ecaron: "\u011A", ecaron: "\u011B", Ecirc: "\xCA", ecirc: "\xEA", ecir: "\u2256", ecolon: "\u2255", Ecy: "\u042D", ecy: "\u044D", eDDot: "\u2A77", Edot: "\u0116", edot: "\u0117", eDot: "\u2251", ee: "\u2147", efDot: "\u2252", Efr: "\u{1D508}", efr: "\u{1D522}", eg: "\u2A9A", Egrave: "\xC8", egrave: "\xE8", egs: "\u2A96", egsdot: "\u2A98", el: "\u2A99", Element: "\u2208", elinters: "\u23E7", ell: "\u2113", els: "\u2A95", elsdot: "\u2A97", Emacr: "\u0112", emacr: "\u0113", empty: "\u2205", emptyset: "\u2205", EmptySmallSquare: "\u25FB", emptyv: "\u2205", EmptyVerySmallSquare: "\u25AB", emsp13: "\u2004", emsp14: "\u2005", emsp: "\u2003", ENG: "\u014A", eng: "\u014B", ensp: "\u2002", Eogon: "\u0118", eogon: "\u0119", Eopf: "\u{1D53C}", eopf: "\u{1D556}", epar: "\u22D5", eparsl: "\u29E3", eplus: "\u2A71", epsi: "\u03B5", Epsilon: "\u0395", epsilon: "\u03B5", epsiv: "\u03F5", eqcirc: "\u2256", eqcolon: "\u2255", eqsim: "\u2242", eqslantgtr: "\u2A96", eqslantless: "\u2A95", Equal: "\u2A75", equals: "=", EqualTilde: "\u2242", equest: "\u225F", Equilibrium: "\u21CC", equiv: "\u2261", equivDD: "\u2A78", eqvparsl: "\u29E5", erarr: "\u2971", erDot: "\u2253", escr: "\u212F", Escr: "\u2130", esdot: "\u2250", Esim: "\u2A73", esim: "\u2242", Eta: "\u0397", eta: "\u03B7", ETH: "\xD0", eth: "\xF0", Euml: "\xCB", euml: "\xEB", euro: "\u20AC", excl: "!", exist: "\u2203", Exists: "\u2203", expectation: "\u2130", exponentiale: "\u2147", ExponentialE: "\u2147", fallingdotseq: "\u2252", Fcy: "\u0424", fcy: "\u0444", female: "\u2640", ffilig: "\uFB03", fflig: "\uFB00", ffllig: "\uFB04", Ffr: "\u{1D509}", ffr: "\u{1D523}", filig: "\uFB01", FilledSmallSquare: "\u25FC", FilledVerySmallSquare: "\u25AA", fjlig: "fj", flat: "\u266D", fllig: "\uFB02", fltns: "\u25B1", fnof: "\u0192", Fopf: "\u{1D53D}", fopf: "\u{1D557}", forall: "\u2200", ForAll: "\u2200", fork: "\u22D4", forkv: "\u2AD9", Fouriertrf: "\u2131", fpartint: "\u2A0D", frac12: "\xBD", frac13: "\u2153", frac14: "\xBC", frac15: "\u2155", frac16: "\u2159", frac18: "\u215B", frac23: "\u2154", frac25: "\u2156", frac34: "\xBE", frac35: "\u2157", frac38: "\u215C", frac45: "\u2158", frac56: "\u215A", frac58: "\u215D", frac78: "\u215E", frasl: "\u2044", frown: "\u2322", fscr: "\u{1D4BB}", Fscr: "\u2131", gacute: "\u01F5", Gamma: "\u0393", gamma: "\u03B3", Gammad: "\u03DC", gammad: "\u03DD", gap: "\u2A86", Gbreve: "\u011E", gbreve: "\u011F", Gcedil: "\u0122", Gcirc: "\u011C", gcirc: "\u011D", Gcy: "\u0413", gcy: "\u0433", Gdot: "\u0120", gdot: "\u0121", ge: "\u2265", gE: "\u2267", gEl: "\u2A8C", gel: "\u22DB", geq: "\u2265", geqq: "\u2267", geqslant: "\u2A7E", gescc: "\u2AA9", ges: "\u2A7E", gesdot: "\u2A80", gesdoto: "\u2A82", gesdotol: "\u2A84", gesl: "\u22DB\uFE00", gesles: "\u2A94", Gfr: "\u{1D50A}", gfr: "\u{1D524}", gg: "\u226B", Gg: "\u22D9", ggg: "\u22D9", gimel: "\u2137", GJcy: "\u0403", gjcy: "\u0453", gla: "\u2AA5", gl: "\u2277", glE: "\u2A92", glj: "\u2AA4", gnap: "\u2A8A", gnapprox: "\u2A8A", gne: "\u2A88", gnE: "\u2269", gneq: "\u2A88", gneqq: "\u2269", gnsim: "\u22E7", Gopf: "\u{1D53E}", gopf: "\u{1D558}", grave: "`", GreaterEqual: "\u2265", GreaterEqualLess: "\u22DB", GreaterFullEqual: "\u2267", GreaterGreater: "\u2AA2", GreaterLess: "\u2277", GreaterSlantEqual: "\u2A7E", GreaterTilde: "\u2273", Gscr: "\u{1D4A2}", gscr: "\u210A", gsim: "\u2273", gsime: "\u2A8E", gsiml: "\u2A90", gtcc: "\u2AA7", gtcir: "\u2A7A", gt: ">", GT: ">", Gt: "\u226B", gtdot: "\u22D7", gtlPar: "\u2995", gtquest: "\u2A7C", gtrapprox: "\u2A86", gtrarr: "\u2978", gtrdot: "\u22D7", gtreqless: "\u22DB", gtreqqless: "\u2A8C", gtrless: "\u2277", gtrsim: "\u2273", gvertneqq: "\u2269\uFE00", gvnE: "\u2269\uFE00", Hacek: "\u02C7", hairsp: "\u200A", half: "\xBD", hamilt: "\u210B", HARDcy: "\u042A", hardcy: "\u044A", harrcir: "\u2948", harr: "\u2194", hArr: "\u21D4", harrw: "\u21AD", Hat: "^", hbar: "\u210F", Hcirc: "\u0124", hcirc: "\u0125", hearts: "\u2665", heartsuit: "\u2665", hellip: "\u2026", hercon: "\u22B9", hfr: "\u{1D525}", Hfr: "\u210C", HilbertSpace: "\u210B", hksearow: "\u2925", hkswarow: "\u2926", hoarr: "\u21FF", homtht: "\u223B", hookleftarrow: "\u21A9", hookrightarrow: "\u21AA", hopf: "\u{1D559}", Hopf: "\u210D", horbar: "\u2015", HorizontalLine: "\u2500", hscr: "\u{1D4BD}", Hscr: "\u210B", hslash: "\u210F", Hstrok: "\u0126", hstrok: "\u0127", HumpDownHump: "\u224E", HumpEqual: "\u224F", hybull: "\u2043", hyphen: "\u2010", Iacute: "\xCD", iacute: "\xED", ic: "\u2063", Icirc: "\xCE", icirc: "\xEE", Icy: "\u0418", icy: "\u0438", Idot: "\u0130", IEcy: "\u0415", iecy: "\u0435", iexcl: "\xA1", iff: "\u21D4", ifr: "\u{1D526}", Ifr: "\u2111", Igrave: "\xCC", igrave: "\xEC", ii: "\u2148", iiiint: "\u2A0C", iiint: "\u222D", iinfin: "\u29DC", iiota: "\u2129", IJlig: "\u0132", ijlig: "\u0133", Imacr: "\u012A", imacr: "\u012B", image: "\u2111", ImaginaryI: "\u2148", imagline: "\u2110", imagpart: "\u2111", imath: "\u0131", Im: "\u2111", imof: "\u22B7", imped: "\u01B5", Implies: "\u21D2", incare: "\u2105", in: "\u2208", infin: "\u221E", infintie: "\u29DD", inodot: "\u0131", intcal: "\u22BA", int: "\u222B", Int: "\u222C", integers: "\u2124", Integral: "\u222B", intercal: "\u22BA", Intersection: "\u22C2", intlarhk: "\u2A17", intprod: "\u2A3C", InvisibleComma: "\u2063", InvisibleTimes: "\u2062", IOcy: "\u0401", iocy: "\u0451", Iogon: "\u012E", iogon: "\u012F", Iopf: "\u{1D540}", iopf: "\u{1D55A}", Iota: "\u0399", iota: "\u03B9", iprod: "\u2A3C", iquest: "\xBF", iscr: "\u{1D4BE}", Iscr: "\u2110", isin: "\u2208", isindot: "\u22F5", isinE: "\u22F9", isins: "\u22F4", isinsv: "\u22F3", isinv: "\u2208", it: "\u2062", Itilde: "\u0128", itilde: "\u0129", Iukcy: "\u0406", iukcy: "\u0456", Iuml: "\xCF", iuml: "\xEF", Jcirc: "\u0134", jcirc: "\u0135", Jcy: "\u0419", jcy: "\u0439", Jfr: "\u{1D50D}", jfr: "\u{1D527}", jmath: "\u0237", Jopf: "\u{1D541}", jopf: "\u{1D55B}", Jscr: "\u{1D4A5}", jscr: "\u{1D4BF}", Jsercy: "\u0408", jsercy: "\u0458", Jukcy: "\u0404", jukcy: "\u0454", Kappa: "\u039A", kappa: "\u03BA", kappav: "\u03F0", Kcedil: "\u0136", kcedil: "\u0137", Kcy: "\u041A", kcy: "\u043A", Kfr: "\u{1D50E}", kfr: "\u{1D528}", kgreen: "\u0138", KHcy: "\u0425", khcy: "\u0445", KJcy: "\u040C", kjcy: "\u045C", Kopf: "\u{1D542}", kopf: "\u{1D55C}", Kscr: "\u{1D4A6}", kscr: "\u{1D4C0}", lAarr: "\u21DA", Lacute: "\u0139", lacute: "\u013A", laemptyv: "\u29B4", lagran: "\u2112", Lambda: "\u039B", lambda: "\u03BB", lang: "\u27E8", Lang: "\u27EA", langd: "\u2991", langle: "\u27E8", lap: "\u2A85", Laplacetrf: "\u2112", laquo: "\xAB", larrb: "\u21E4", larrbfs: "\u291F", larr: "\u2190", Larr: "\u219E", lArr: "\u21D0", larrfs: "\u291D", larrhk: "\u21A9", larrlp: "\u21AB", larrpl: "\u2939", larrsim: "\u2973", larrtl: "\u21A2", latail: "\u2919", lAtail: "\u291B", lat: "\u2AAB", late: "\u2AAD", lates: "\u2AAD\uFE00", lbarr: "\u290C", lBarr: "\u290E", lbbrk: "\u2772", lbrace: "{", lbrack: "[", lbrke: "\u298B", lbrksld: "\u298F", lbrkslu: "\u298D", Lcaron: "\u013D", lcaron: "\u013E", Lcedil: "\u013B", lcedil: "\u013C", lceil: "\u2308", lcub: "{", Lcy: "\u041B", lcy: "\u043B", ldca: "\u2936", ldquo: "\u201C", ldquor: "\u201E", ldrdhar: "\u2967", ldrushar: "\u294B", ldsh: "\u21B2", le: "\u2264", lE: "\u2266", LeftAngleBracket: "\u27E8", LeftArrowBar: "\u21E4", leftarrow: "\u2190", LeftArrow: "\u2190", Leftarrow: "\u21D0", LeftArrowRightArrow: "\u21C6", leftarrowtail: "\u21A2", LeftCeiling: "\u2308", LeftDoubleBracket: "\u27E6", LeftDownTeeVector: "\u2961", LeftDownVectorBar: "\u2959", LeftDownVector: "\u21C3", LeftFloor: "\u230A", leftharpoondown: "\u21BD", leftharpoonup: "\u21BC", leftleftarrows: "\u21C7", leftrightarrow: "\u2194", LeftRightArrow: "\u2194", Leftrightarrow: "\u21D4", leftrightarrows: "\u21C6", leftrightharpoons: "\u21CB", leftrightsquigarrow: "\u21AD", LeftRightVector: "\u294E", LeftTeeArrow: "\u21A4", LeftTee: "\u22A3", LeftTeeVector: "\u295A", leftthreetimes: "\u22CB", LeftTriangleBar: "\u29CF", LeftTriangle: "\u22B2", LeftTriangleEqual: "\u22B4", LeftUpDownVector: "\u2951", LeftUpTeeVector: "\u2960", LeftUpVectorBar: "\u2958", LeftUpVector: "\u21BF", LeftVectorBar: "\u2952", LeftVector: "\u21BC", lEg: "\u2A8B", leg: "\u22DA", leq: "\u2264", leqq: "\u2266", leqslant: "\u2A7D", lescc: "\u2AA8", les: "\u2A7D", lesdot: "\u2A7F", lesdoto: "\u2A81", lesdotor: "\u2A83", lesg: "\u22DA\uFE00", lesges: "\u2A93", lessapprox: "\u2A85", lessdot: "\u22D6", lesseqgtr: "\u22DA", lesseqqgtr: "\u2A8B", LessEqualGreater: "\u22DA", LessFullEqual: "\u2266", LessGreater: "\u2276", lessgtr: "\u2276", LessLess: "\u2AA1", lesssim: "\u2272", LessSlantEqual: "\u2A7D", LessTilde: "\u2272", lfisht: "\u297C", lfloor: "\u230A", Lfr: "\u{1D50F}", lfr: "\u{1D529}", lg: "\u2276", lgE: "\u2A91", lHar: "\u2962", lhard: "\u21BD", lharu: "\u21BC", lharul: "\u296A", lhblk: "\u2584", LJcy: "\u0409", ljcy: "\u0459", llarr: "\u21C7", ll: "\u226A", Ll: "\u22D8", llcorner: "\u231E", Lleftarrow: "\u21DA", llhard: "\u296B", lltri: "\u25FA", Lmidot: "\u013F", lmidot: "\u0140", lmoustache: "\u23B0", lmoust: "\u23B0", lnap: "\u2A89", lnapprox: "\u2A89", lne: "\u2A87", lnE: "\u2268", lneq: "\u2A87", lneqq: "\u2268", lnsim: "\u22E6", loang: "\u27EC", loarr: "\u21FD", lobrk: "\u27E6", longleftarrow: "\u27F5", LongLeftArrow: "\u27F5", Longleftarrow: "\u27F8", longleftrightarrow: "\u27F7", LongLeftRightArrow: "\u27F7", Longleftrightarrow: "\u27FA", longmapsto: "\u27FC", longrightarrow: "\u27F6", LongRightArrow: "\u27F6", Longrightarrow: "\u27F9", looparrowleft: "\u21AB", looparrowright: "\u21AC", lopar: "\u2985", Lopf: "\u{1D543}", lopf: "\u{1D55D}", loplus: "\u2A2D", lotimes: "\u2A34", lowast: "\u2217", lowbar: "_", LowerLeftArrow: "\u2199", LowerRightArrow: "\u2198", loz: "\u25CA", lozenge: "\u25CA", lozf: "\u29EB", lpar: "(", lparlt: "\u2993", lrarr: "\u21C6", lrcorner: "\u231F", lrhar: "\u21CB", lrhard: "\u296D", lrm: "\u200E", lrtri: "\u22BF", lsaquo: "\u2039", lscr: "\u{1D4C1}", Lscr: "\u2112", lsh: "\u21B0", Lsh: "\u21B0", lsim: "\u2272", lsime: "\u2A8D", lsimg: "\u2A8F", lsqb: "[", lsquo: "\u2018", lsquor: "\u201A", Lstrok: "\u0141", lstrok: "\u0142", ltcc: "\u2AA6", ltcir: "\u2A79", lt: "<", LT: "<", Lt: "\u226A", ltdot: "\u22D6", lthree: "\u22CB", ltimes: "\u22C9", ltlarr: "\u2976", ltquest: "\u2A7B", ltri: "\u25C3", ltrie: "\u22B4", ltrif: "\u25C2", ltrPar: "\u2996", lurdshar: "\u294A", luruhar: "\u2966", lvertneqq: "\u2268\uFE00", lvnE: "\u2268\uFE00", macr: "\xAF", male: "\u2642", malt: "\u2720", maltese: "\u2720", Map: "\u2905", map: "\u21A6", mapsto: "\u21A6", mapstodown: "\u21A7", mapstoleft: "\u21A4", mapstoup: "\u21A5", marker: "\u25AE", mcomma: "\u2A29", Mcy: "\u041C", mcy: "\u043C", mdash: "\u2014", mDDot: "\u223A", measuredangle: "\u2221", MediumSpace: "\u205F", Mellintrf: "\u2133", Mfr: "\u{1D510}", mfr: "\u{1D52A}", mho: "\u2127", micro: "\xB5", midast: "*", midcir: "\u2AF0", mid: "\u2223", middot: "\xB7", minusb: "\u229F", minus: "\u2212", minusd: "\u2238", minusdu: "\u2A2A", MinusPlus: "\u2213", mlcp: "\u2ADB", mldr: "\u2026", mnplus: "\u2213", models: "\u22A7", Mopf: "\u{1D544}", mopf: "\u{1D55E}", mp: "\u2213", mscr: "\u{1D4C2}", Mscr: "\u2133", mstpos: "\u223E", Mu: "\u039C", mu: "\u03BC", multimap: "\u22B8", mumap: "\u22B8", nabla: "\u2207", Nacute: "\u0143", nacute: "\u0144", nang: "\u2220\u20D2", nap: "\u2249", napE: "\u2A70\u0338", napid: "\u224B\u0338", napos: "\u0149", napprox: "\u2249", natural: "\u266E", naturals: "\u2115", natur: "\u266E", nbsp: "\xA0", nbump: "\u224E\u0338", nbumpe: "\u224F\u0338", ncap: "\u2A43", Ncaron: "\u0147", ncaron: "\u0148", Ncedil: "\u0145", ncedil: "\u0146", ncong: "\u2247", ncongdot: "\u2A6D\u0338", ncup: "\u2A42", Ncy: "\u041D", ncy: "\u043D", ndash: "\u2013", nearhk: "\u2924", nearr: "\u2197", neArr: "\u21D7", nearrow: "\u2197", ne: "\u2260", nedot: "\u2250\u0338", NegativeMediumSpace: "\u200B", NegativeThickSpace: "\u200B", NegativeThinSpace: "\u200B", NegativeVeryThinSpace: "\u200B", nequiv: "\u2262", nesear: "\u2928", nesim: "\u2242\u0338", NestedGreaterGreater: "\u226B", NestedLessLess: "\u226A", NewLine: "\n", nexist: "\u2204", nexists: "\u2204", Nfr: "\u{1D511}", nfr: "\u{1D52B}", ngE: "\u2267\u0338", nge: "\u2271", ngeq: "\u2271", ngeqq: "\u2267\u0338", ngeqslant: "\u2A7E\u0338", nges: "\u2A7E\u0338", nGg: "\u22D9\u0338", ngsim: "\u2275", nGt: "\u226B\u20D2", ngt: "\u226F", ngtr: "\u226F", nGtv: "\u226B\u0338", nharr: "\u21AE", nhArr: "\u21CE", nhpar: "\u2AF2", ni: "\u220B", nis: "\u22FC", nisd: "\u22FA", niv: "\u220B", NJcy: "\u040A", njcy: "\u045A", nlarr: "\u219A", nlArr: "\u21CD", nldr: "\u2025", nlE: "\u2266\u0338", nle: "\u2270", nleftarrow: "\u219A", nLeftarrow: "\u21CD", nleftrightarrow: "\u21AE", nLeftrightarrow: "\u21CE", nleq: "\u2270", nleqq: "\u2266\u0338", nleqslant: "\u2A7D\u0338", nles: "\u2A7D\u0338", nless: "\u226E", nLl: "\u22D8\u0338", nlsim: "\u2274", nLt: "\u226A\u20D2", nlt: "\u226E", nltri: "\u22EA", nltrie: "\u22EC", nLtv: "\u226A\u0338", nmid: "\u2224", NoBreak: "\u2060", NonBreakingSpace: "\xA0", nopf: "\u{1D55F}", Nopf: "\u2115", Not: "\u2AEC", not: "\xAC", NotCongruent: "\u2262", NotCupCap: "\u226D", NotDoubleVerticalBar: "\u2226", NotElement: "\u2209", NotEqual: "\u2260", NotEqualTilde: "\u2242\u0338", NotExists: "\u2204", NotGreater: "\u226F", NotGreaterEqual: "\u2271", NotGreaterFullEqual: "\u2267\u0338", NotGreaterGreater: "\u226B\u0338", NotGreaterLess: "\u2279", NotGreaterSlantEqual: "\u2A7E\u0338", NotGreaterTilde: "\u2275", NotHumpDownHump: "\u224E\u0338", NotHumpEqual: "\u224F\u0338", notin: "\u2209", notindot: "\u22F5\u0338", notinE: "\u22F9\u0338", notinva: "\u2209", notinvb: "\u22F7", notinvc: "\u22F6", NotLeftTriangleBar: "\u29CF\u0338", NotLeftTriangle: "\u22EA", NotLeftTriangleEqual: "\u22EC", NotLess: "\u226E", NotLessEqual: "\u2270", NotLessGreater: "\u2278", NotLessLess: "\u226A\u0338", NotLessSlantEqual: "\u2A7D\u0338", NotLessTilde: "\u2274", NotNestedGreaterGreater: "\u2AA2\u0338", NotNestedLessLess: "\u2AA1\u0338", notni: "\u220C", notniva: "\u220C", notnivb: "\u22FE", notnivc: "\u22FD", NotPrecedes: "\u2280", NotPrecedesEqual: "\u2AAF\u0338", NotPrecedesSlantEqual: "\u22E0", NotReverseElement: "\u220C", NotRightTriangleBar: "\u29D0\u0338", NotRightTriangle: "\u22EB", NotRightTriangleEqual: "\u22ED", NotSquareSubset: "\u228F\u0338", NotSquareSubsetEqual: "\u22E2", NotSquareSuperset: "\u2290\u0338", NotSquareSupersetEqual: "\u22E3", NotSubset: "\u2282\u20D2", NotSubsetEqual: "\u2288", NotSucceeds: "\u2281", NotSucceedsEqual: "\u2AB0\u0338", NotSucceedsSlantEqual: "\u22E1", NotSucceedsTilde: "\u227F\u0338", NotSuperset: "\u2283\u20D2", NotSupersetEqual: "\u2289", NotTilde: "\u2241", NotTildeEqual: "\u2244", NotTildeFullEqual: "\u2247", NotTildeTilde: "\u2249", NotVerticalBar: "\u2224", nparallel: "\u2226", npar: "\u2226", nparsl: "\u2AFD\u20E5", npart: "\u2202\u0338", npolint: "\u2A14", npr: "\u2280", nprcue: "\u22E0", nprec: "\u2280", npreceq: "\u2AAF\u0338", npre: "\u2AAF\u0338", nrarrc: "\u2933\u0338", nrarr: "\u219B", nrArr: "\u21CF", nrarrw: "\u219D\u0338", nrightarrow: "\u219B", nRightarrow: "\u21CF", nrtri: "\u22EB", nrtrie: "\u22ED", nsc: "\u2281", nsccue: "\u22E1", nsce: "\u2AB0\u0338", Nscr: "\u{1D4A9}", nscr: "\u{1D4C3}", nshortmid: "\u2224", nshortparallel: "\u2226", nsim: "\u2241", nsime: "\u2244", nsimeq: "\u2244", nsmid: "\u2224", nspar: "\u2226", nsqsube: "\u22E2", nsqsupe: "\u22E3", nsub: "\u2284", nsubE: "\u2AC5\u0338", nsube: "\u2288", nsubset: "\u2282\u20D2", nsubseteq: "\u2288", nsubseteqq: "\u2AC5\u0338", nsucc: "\u2281", nsucceq: "\u2AB0\u0338", nsup: "\u2285", nsupE: "\u2AC6\u0338", nsupe: "\u2289", nsupset: "\u2283\u20D2", nsupseteq: "\u2289", nsupseteqq: "\u2AC6\u0338", ntgl: "\u2279", Ntilde: "\xD1", ntilde: "\xF1", ntlg: "\u2278", ntriangleleft: "\u22EA", ntrianglelefteq: "\u22EC", ntriangleright: "\u22EB", ntrianglerighteq: "\u22ED", Nu: "\u039D", nu: "\u03BD", num: "#", numero: "\u2116", numsp: "\u2007", nvap: "\u224D\u20D2", nvdash: "\u22AC", nvDash: "\u22AD", nVdash: "\u22AE", nVDash: "\u22AF", nvge: "\u2265\u20D2", nvgt: ">\u20D2", nvHarr: "\u2904", nvinfin: "\u29DE", nvlArr: "\u2902", nvle: "\u2264\u20D2", nvlt: "<\u20D2", nvltrie: "\u22B4\u20D2", nvrArr: "\u2903", nvrtrie: "\u22B5\u20D2", nvsim: "\u223C\u20D2", nwarhk: "\u2923", nwarr: "\u2196", nwArr: "\u21D6", nwarrow: "\u2196", nwnear: "\u2927", Oacute: "\xD3", oacute: "\xF3", oast: "\u229B", Ocirc: "\xD4", ocirc: "\xF4", ocir: "\u229A", Ocy: "\u041E", ocy: "\u043E", odash: "\u229D", Odblac: "\u0150", odblac: "\u0151", odiv: "\u2A38", odot: "\u2299", odsold: "\u29BC", OElig: "\u0152", oelig: "\u0153", ofcir: "\u29BF", Ofr: "\u{1D512}", ofr: "\u{1D52C}", ogon: "\u02DB", Ograve: "\xD2", ograve: "\xF2", ogt: "\u29C1", ohbar: "\u29B5", ohm: "\u03A9", oint: "\u222E", olarr: "\u21BA", olcir: "\u29BE", olcross: "\u29BB", oline: "\u203E", olt: "\u29C0", Omacr: "\u014C", omacr: "\u014D", Omega: "\u03A9", omega: "\u03C9", Omicron: "\u039F", omicron: "\u03BF", omid: "\u29B6", ominus: "\u2296", Oopf: "\u{1D546}", oopf: "\u{1D560}", opar: "\u29B7", OpenCurlyDoubleQuote: "\u201C", OpenCurlyQuote: "\u2018", operp: "\u29B9", oplus: "\u2295", orarr: "\u21BB", Or: "\u2A54", or: "\u2228", ord: "\u2A5D", order: "\u2134", orderof: "\u2134", ordf: "\xAA", ordm: "\xBA", origof: "\u22B6", oror: "\u2A56", orslope: "\u2A57", orv: "\u2A5B", oS: "\u24C8", Oscr: "\u{1D4AA}", oscr: "\u2134", Oslash: "\xD8", oslash: "\xF8", osol: "\u2298", Otilde: "\xD5", otilde: "\xF5", otimesas: "\u2A36", Otimes: "\u2A37", otimes: "\u2297", Ouml: "\xD6", ouml: "\xF6", ovbar: "\u233D", OverBar: "\u203E", OverBrace: "\u23DE", OverBracket: "\u23B4", OverParenthesis: "\u23DC", para: "\xB6", parallel: "\u2225", par: "\u2225", parsim: "\u2AF3", parsl: "\u2AFD", part: "\u2202", PartialD: "\u2202", Pcy: "\u041F", pcy: "\u043F", percnt: "%", period: ".", permil: "\u2030", perp: "\u22A5", pertenk: "\u2031", Pfr: "\u{1D513}", pfr: "\u{1D52D}", Phi: "\u03A6", phi: "\u03C6", phiv: "\u03D5", phmmat: "\u2133", phone: "\u260E", Pi: "\u03A0", pi: "\u03C0", pitchfork: "\u22D4", piv: "\u03D6", planck: "\u210F", planckh: "\u210E", plankv: "\u210F", plusacir: "\u2A23", plusb: "\u229E", pluscir: "\u2A22", plus: "+", plusdo: "\u2214", plusdu: "\u2A25", pluse: "\u2A72", PlusMinus: "\xB1", plusmn: "\xB1", plussim: "\u2A26", plustwo: "\u2A27", pm: "\xB1", Poincareplane: "\u210C", pointint: "\u2A15", popf: "\u{1D561}", Popf: "\u2119", pound: "\xA3", prap: "\u2AB7", Pr: "\u2ABB", pr: "\u227A", prcue: "\u227C", precapprox: "\u2AB7", prec: "\u227A", preccurlyeq: "\u227C", Precedes: "\u227A", PrecedesEqual: "\u2AAF", PrecedesSlantEqual: "\u227C", PrecedesTilde: "\u227E", preceq: "\u2AAF", precnapprox: "\u2AB9", precneqq: "\u2AB5", precnsim: "\u22E8", pre: "\u2AAF", prE: "\u2AB3", precsim: "\u227E", prime: "\u2032", Prime: "\u2033", primes: "\u2119", prnap: "\u2AB9", prnE: "\u2AB5", prnsim: "\u22E8", prod: "\u220F", Product: "\u220F", profalar: "\u232E", profline: "\u2312", profsurf: "\u2313", prop: "\u221D", Proportional: "\u221D", Proportion: "\u2237", propto: "\u221D", prsim: "\u227E", prurel: "\u22B0", Pscr: "\u{1D4AB}", pscr: "\u{1D4C5}", Psi: "\u03A8", psi: "\u03C8", puncsp: "\u2008", Qfr: "\u{1D514}", qfr: "\u{1D52E}", qint: "\u2A0C", qopf: "\u{1D562}", Qopf: "\u211A", qprime: "\u2057", Qscr: "\u{1D4AC}", qscr: "\u{1D4C6}", quaternions: "\u210D", quatint: "\u2A16", quest: "?", questeq: "\u225F", quot: '"', QUOT: '"', rAarr: "\u21DB", race: "\u223D\u0331", Racute: "\u0154", racute: "\u0155", radic: "\u221A", raemptyv: "\u29B3", rang: "\u27E9", Rang: "\u27EB", rangd: "\u2992", range: "\u29A5", rangle: "\u27E9", raquo: "\xBB", rarrap: "\u2975", rarrb: "\u21E5", rarrbfs: "\u2920", rarrc: "\u2933", rarr: "\u2192", Rarr: "\u21A0", rArr: "\u21D2", rarrfs: "\u291E", rarrhk: "\u21AA", rarrlp: "\u21AC", rarrpl: "\u2945", rarrsim: "\u2974", Rarrtl: "\u2916", rarrtl: "\u21A3", rarrw: "\u219D", ratail: "\u291A", rAtail: "\u291C", ratio: "\u2236", rationals: "\u211A", rbarr: "\u290D", rBarr: "\u290F", RBarr: "\u2910", rbbrk: "\u2773", rbrace: "}", rbrack: "]", rbrke: "\u298C", rbrksld: "\u298E", rbrkslu: "\u2990", Rcaron: "\u0158", rcaron: "\u0159", Rcedil: "\u0156", rcedil: "\u0157", rceil: "\u2309", rcub: "}", Rcy: "\u0420", rcy: "\u0440", rdca: "\u2937", rdldhar: "\u2969", rdquo: "\u201D", rdquor: "\u201D", rdsh: "\u21B3", real: "\u211C", realine: "\u211B", realpart: "\u211C", reals: "\u211D", Re: "\u211C", rect: "\u25AD", reg: "\xAE", REG: "\xAE", ReverseElement: "\u220B", ReverseEquilibrium: "\u21CB", ReverseUpEquilibrium: "\u296F", rfisht: "\u297D", rfloor: "\u230B", rfr: "\u{1D52F}", Rfr: "\u211C", rHar: "\u2964", rhard: "\u21C1", rharu: "\u21C0", rharul: "\u296C", Rho: "\u03A1", rho: "\u03C1", rhov: "\u03F1", RightAngleBracket: "\u27E9", RightArrowBar: "\u21E5", rightarrow: "\u2192", RightArrow: "\u2192", Rightarrow: "\u21D2", RightArrowLeftArrow: "\u21C4", rightarrowtail: "\u21A3", RightCeiling: "\u2309", RightDoubleBracket: "\u27E7", RightDownTeeVector: "\u295D", RightDownVectorBar: "\u2955", RightDownVector: "\u21C2", RightFloor: "\u230B", rightharpoondown: "\u21C1", rightharpoonup: "\u21C0", rightleftarrows: "\u21C4", rightleftharpoons: "\u21CC", rightrightarrows: "\u21C9", rightsquigarrow: "\u219D", RightTeeArrow: "\u21A6", RightTee: "\u22A2", RightTeeVector: "\u295B", rightthreetimes: "\u22CC", RightTriangleBar: "\u29D0", RightTriangle: "\u22B3", RightTriangleEqual: "\u22B5", RightUpDownVector: "\u294F", RightUpTeeVector: "\u295C", RightUpVectorBar: "\u2954", RightUpVector: "\u21BE", RightVectorBar: "\u2953", RightVector: "\u21C0", ring: "\u02DA", risingdotseq: "\u2253", rlarr: "\u21C4", rlhar: "\u21CC", rlm: "\u200F", rmoustache: "\u23B1", rmoust: "\u23B1", rnmid: "\u2AEE", roang: "\u27ED", roarr: "\u21FE", robrk: "\u27E7", ropar: "\u2986", ropf: "\u{1D563}", Ropf: "\u211D", roplus: "\u2A2E", rotimes: "\u2A35", RoundImplies: "\u2970", rpar: ")", rpargt: "\u2994", rppolint: "\u2A12", rrarr: "\u21C9", Rrightarrow: "\u21DB", rsaquo: "\u203A", rscr: "\u{1D4C7}", Rscr: "\u211B", rsh: "\u21B1", Rsh: "\u21B1", rsqb: "]", rsquo: "\u2019", rsquor: "\u2019", rthree: "\u22CC", rtimes: "\u22CA", rtri: "\u25B9", rtrie: "\u22B5", rtrif: "\u25B8", rtriltri: "\u29CE", RuleDelayed: "\u29F4", ruluhar: "\u2968", rx: "\u211E", Sacute: "\u015A", sacute: "\u015B", sbquo: "\u201A", scap: "\u2AB8", Scaron: "\u0160", scaron: "\u0161", Sc: "\u2ABC", sc: "\u227B", sccue: "\u227D", sce: "\u2AB0", scE: "\u2AB4", Scedil: "\u015E", scedil: "\u015F", Scirc: "\u015C", scirc: "\u015D", scnap: "\u2ABA", scnE: "\u2AB6", scnsim: "\u22E9", scpolint: "\u2A13", scsim: "\u227F", Scy: "\u0421", scy: "\u0441", sdotb: "\u22A1", sdot: "\u22C5", sdote: "\u2A66", searhk: "\u2925", searr: "\u2198", seArr: "\u21D8", searrow: "\u2198", sect: "\xA7", semi: ";", seswar: "\u2929", setminus: "\u2216", setmn: "\u2216", sext: "\u2736", Sfr: "\u{1D516}", sfr: "\u{1D530}", sfrown: "\u2322", sharp: "\u266F", SHCHcy: "\u0429", shchcy: "\u0449", SHcy: "\u0428", shcy: "\u0448", ShortDownArrow: "\u2193", ShortLeftArrow: "\u2190", shortmid: "\u2223", shortparallel: "\u2225", ShortRightArrow: "\u2192", ShortUpArrow: "\u2191", shy: "\xAD", Sigma: "\u03A3", sigma: "\u03C3", sigmaf: "\u03C2", sigmav: "\u03C2", sim: "\u223C", simdot: "\u2A6A", sime: "\u2243", simeq: "\u2243", simg: "\u2A9E", simgE: "\u2AA0", siml: "\u2A9D", simlE: "\u2A9F", simne: "\u2246", simplus: "\u2A24", simrarr: "\u2972", slarr: "\u2190", SmallCircle: "\u2218", smallsetminus: "\u2216", smashp: "\u2A33", smeparsl: "\u29E4", smid: "\u2223", smile: "\u2323", smt: "\u2AAA", smte: "\u2AAC", smtes: "\u2AAC\uFE00", SOFTcy: "\u042C", softcy: "\u044C", solbar: "\u233F", solb: "\u29C4", sol: "/", Sopf: "\u{1D54A}", sopf: "\u{1D564}", spades: "\u2660", spadesuit: "\u2660", spar: "\u2225", sqcap: "\u2293", sqcaps: "\u2293\uFE00", sqcup: "\u2294", sqcups: "\u2294\uFE00", Sqrt: "\u221A", sqsub: "\u228F", sqsube: "\u2291", sqsubset: "\u228F", sqsubseteq: "\u2291", sqsup: "\u2290", sqsupe: "\u2292", sqsupset: "\u2290", sqsupseteq: "\u2292", square: "\u25A1", Square: "\u25A1", SquareIntersection: "\u2293", SquareSubset: "\u228F", SquareSubsetEqual: "\u2291", SquareSuperset: "\u2290", SquareSupersetEqual: "\u2292", SquareUnion: "\u2294", squarf: "\u25AA", squ: "\u25A1", squf: "\u25AA", srarr: "\u2192", Sscr: "\u{1D4AE}", sscr: "\u{1D4C8}", ssetmn: "\u2216", ssmile: "\u2323", sstarf: "\u22C6", Star: "\u22C6", star: "\u2606", starf: "\u2605", straightepsilon: "\u03F5", straightphi: "\u03D5", strns: "\xAF", sub: "\u2282", Sub: "\u22D0", subdot: "\u2ABD", subE: "\u2AC5", sube: "\u2286", subedot: "\u2AC3", submult: "\u2AC1", subnE: "\u2ACB", subne: "\u228A", subplus: "\u2ABF", subrarr: "\u2979", subset: "\u2282", Subset: "\u22D0", subseteq: "\u2286", subseteqq: "\u2AC5", SubsetEqual: "\u2286", subsetneq: "\u228A", subsetneqq: "\u2ACB", subsim: "\u2AC7", subsub: "\u2AD5", subsup: "\u2AD3", succapprox: "\u2AB8", succ: "\u227B", succcurlyeq: "\u227D", Succeeds: "\u227B", SucceedsEqual: "\u2AB0", SucceedsSlantEqual: "\u227D", SucceedsTilde: "\u227F", succeq: "\u2AB0", succnapprox: "\u2ABA", succneqq: "\u2AB6", succnsim: "\u22E9", succsim: "\u227F", SuchThat: "\u220B", sum: "\u2211", Sum: "\u2211", sung: "\u266A", sup1: "\xB9", sup2: "\xB2", sup3: "\xB3", sup: "\u2283", Sup: "\u22D1", supdot: "\u2ABE", supdsub: "\u2AD8", supE: "\u2AC6", supe: "\u2287", supedot: "\u2AC4", Superset: "\u2283", SupersetEqual: "\u2287", suphsol: "\u27C9", suphsub: "\u2AD7", suplarr: "\u297B", supmult: "\u2AC2", supnE: "\u2ACC", supne: "\u228B", supplus: "\u2AC0", supset: "\u2283", Supset: "\u22D1", supseteq: "\u2287", supseteqq: "\u2AC6", supsetneq: "\u228B", supsetneqq: "\u2ACC", supsim: "\u2AC8", supsub: "\u2AD4", supsup: "\u2AD6", swarhk: "\u2926", swarr: "\u2199", swArr: "\u21D9", swarrow: "\u2199", swnwar: "\u292A", szlig: "\xDF", Tab: "	", target: "\u2316", Tau: "\u03A4", tau: "\u03C4", tbrk: "\u23B4", Tcaron: "\u0164", tcaron: "\u0165", Tcedil: "\u0162", tcedil: "\u0163", Tcy: "\u0422", tcy: "\u0442", tdot: "\u20DB", telrec: "\u2315", Tfr: "\u{1D517}", tfr: "\u{1D531}", there4: "\u2234", therefore: "\u2234", Therefore: "\u2234", Theta: "\u0398", theta: "\u03B8", thetasym: "\u03D1", thetav: "\u03D1", thickapprox: "\u2248", thicksim: "\u223C", ThickSpace: "\u205F\u200A", ThinSpace: "\u2009", thinsp: "\u2009", thkap: "\u2248", thksim: "\u223C", THORN: "\xDE", thorn: "\xFE", tilde: "\u02DC", Tilde: "\u223C", TildeEqual: "\u2243", TildeFullEqual: "\u2245", TildeTilde: "\u2248", timesbar: "\u2A31", timesb: "\u22A0", times: "\xD7", timesd: "\u2A30", tint: "\u222D", toea: "\u2928", topbot: "\u2336", topcir: "\u2AF1", top: "\u22A4", Topf: "\u{1D54B}", topf: "\u{1D565}", topfork: "\u2ADA", tosa: "\u2929", tprime: "\u2034", trade: "\u2122", TRADE: "\u2122", triangle: "\u25B5", triangledown: "\u25BF", triangleleft: "\u25C3", trianglelefteq: "\u22B4", triangleq: "\u225C", triangleright: "\u25B9", trianglerighteq: "\u22B5", tridot: "\u25EC", trie: "\u225C", triminus: "\u2A3A", TripleDot: "\u20DB", triplus: "\u2A39", trisb: "\u29CD", tritime: "\u2A3B", trpezium: "\u23E2", Tscr: "\u{1D4AF}", tscr: "\u{1D4C9}", TScy: "\u0426", tscy: "\u0446", TSHcy: "\u040B", tshcy: "\u045B", Tstrok: "\u0166", tstrok: "\u0167", twixt: "\u226C", twoheadleftarrow: "\u219E", twoheadrightarrow: "\u21A0", Uacute: "\xDA", uacute: "\xFA", uarr: "\u2191", Uarr: "\u219F", uArr: "\u21D1", Uarrocir: "\u2949", Ubrcy: "\u040E", ubrcy: "\u045E", Ubreve: "\u016C", ubreve: "\u016D", Ucirc: "\xDB", ucirc: "\xFB", Ucy: "\u0423", ucy: "\u0443", udarr: "\u21C5", Udblac: "\u0170", udblac: "\u0171", udhar: "\u296E", ufisht: "\u297E", Ufr: "\u{1D518}", ufr: "\u{1D532}", Ugrave: "\xD9", ugrave: "\xF9", uHar: "\u2963", uharl: "\u21BF", uharr: "\u21BE", uhblk: "\u2580", ulcorn: "\u231C", ulcorner: "\u231C", ulcrop: "\u230F", ultri: "\u25F8", Umacr: "\u016A", umacr: "\u016B", uml: "\xA8", UnderBar: "_", UnderBrace: "\u23DF", UnderBracket: "\u23B5", UnderParenthesis: "\u23DD", Union: "\u22C3", UnionPlus: "\u228E", Uogon: "\u0172", uogon: "\u0173", Uopf: "\u{1D54C}", uopf: "\u{1D566}", UpArrowBar: "\u2912", uparrow: "\u2191", UpArrow: "\u2191", Uparrow: "\u21D1", UpArrowDownArrow: "\u21C5", updownarrow: "\u2195", UpDownArrow: "\u2195", Updownarrow: "\u21D5", UpEquilibrium: "\u296E", upharpoonleft: "\u21BF", upharpoonright: "\u21BE", uplus: "\u228E", UpperLeftArrow: "\u2196", UpperRightArrow: "\u2197", upsi: "\u03C5", Upsi: "\u03D2", upsih: "\u03D2", Upsilon: "\u03A5", upsilon: "\u03C5", UpTeeArrow: "\u21A5", UpTee: "\u22A5", upuparrows: "\u21C8", urcorn: "\u231D", urcorner: "\u231D", urcrop: "\u230E", Uring: "\u016E", uring: "\u016F", urtri: "\u25F9", Uscr: "\u{1D4B0}", uscr: "\u{1D4CA}", utdot: "\u22F0", Utilde: "\u0168", utilde: "\u0169", utri: "\u25B5", utrif: "\u25B4", uuarr: "\u21C8", Uuml: "\xDC", uuml: "\xFC", uwangle: "\u29A7", vangrt: "\u299C", varepsilon: "\u03F5", varkappa: "\u03F0", varnothing: "\u2205", varphi: "\u03D5", varpi: "\u03D6", varpropto: "\u221D", varr: "\u2195", vArr: "\u21D5", varrho: "\u03F1", varsigma: "\u03C2", varsubsetneq: "\u228A\uFE00", varsubsetneqq: "\u2ACB\uFE00", varsupsetneq: "\u228B\uFE00", varsupsetneqq: "\u2ACC\uFE00", vartheta: "\u03D1", vartriangleleft: "\u22B2", vartriangleright: "\u22B3", vBar: "\u2AE8", Vbar: "\u2AEB", vBarv: "\u2AE9", Vcy: "\u0412", vcy: "\u0432", vdash: "\u22A2", vDash: "\u22A8", Vdash: "\u22A9", VDash: "\u22AB", Vdashl: "\u2AE6", veebar: "\u22BB", vee: "\u2228", Vee: "\u22C1", veeeq: "\u225A", vellip: "\u22EE", verbar: "|", Verbar: "\u2016", vert: "|", Vert: "\u2016", VerticalBar: "\u2223", VerticalLine: "|", VerticalSeparator: "\u2758", VerticalTilde: "\u2240", VeryThinSpace: "\u200A", Vfr: "\u{1D519}", vfr: "\u{1D533}", vltri: "\u22B2", vnsub: "\u2282\u20D2", vnsup: "\u2283\u20D2", Vopf: "\u{1D54D}", vopf: "\u{1D567}", vprop: "\u221D", vrtri: "\u22B3", Vscr: "\u{1D4B1}", vscr: "\u{1D4CB}", vsubnE: "\u2ACB\uFE00", vsubne: "\u228A\uFE00", vsupnE: "\u2ACC\uFE00", vsupne: "\u228B\uFE00", Vvdash: "\u22AA", vzigzag: "\u299A", Wcirc: "\u0174", wcirc: "\u0175", wedbar: "\u2A5F", wedge: "\u2227", Wedge: "\u22C0", wedgeq: "\u2259", weierp: "\u2118", Wfr: "\u{1D51A}", wfr: "\u{1D534}", Wopf: "\u{1D54E}", wopf: "\u{1D568}", wp: "\u2118", wr: "\u2240", wreath: "\u2240", Wscr: "\u{1D4B2}", wscr: "\u{1D4CC}", xcap: "\u22C2", xcirc: "\u25EF", xcup: "\u22C3", xdtri: "\u25BD", Xfr: "\u{1D51B}", xfr: "\u{1D535}", xharr: "\u27F7", xhArr: "\u27FA", Xi: "\u039E", xi: "\u03BE", xlarr: "\u27F5", xlArr: "\u27F8", xmap: "\u27FC", xnis: "\u22FB", xodot: "\u2A00", Xopf: "\u{1D54F}", xopf: "\u{1D569}", xoplus: "\u2A01", xotime: "\u2A02", xrarr: "\u27F6", xrArr: "\u27F9", Xscr: "\u{1D4B3}", xscr: "\u{1D4CD}", xsqcup: "\u2A06", xuplus: "\u2A04", xutri: "\u25B3", xvee: "\u22C1", xwedge: "\u22C0", Yacute: "\xDD", yacute: "\xFD", YAcy: "\u042F", yacy: "\u044F", Ycirc: "\u0176", ycirc: "\u0177", Ycy: "\u042B", ycy: "\u044B", yen: "\xA5", Yfr: "\u{1D51C}", yfr: "\u{1D536}", YIcy: "\u0407", yicy: "\u0457", Yopf: "\u{1D550}", yopf: "\u{1D56A}", Yscr: "\u{1D4B4}", yscr: "\u{1D4CE}", YUcy: "\u042E", yucy: "\u044E", yuml: "\xFF", Yuml: "\u0178", Zacute: "\u0179", zacute: "\u017A", Zcaron: "\u017D", zcaron: "\u017E", Zcy: "\u0417", zcy: "\u0437", Zdot: "\u017B", zdot: "\u017C", zeetrf: "\u2128", ZeroWidthSpace: "\u200B", Zeta: "\u0396", zeta: "\u03B6", zfr: "\u{1D537}", Zfr: "\u2128", ZHcy: "\u0416", zhcy: "\u0436", zigrarr: "\u21DD", zopf: "\u{1D56B}", Zopf: "\u2124", Zscr: "\u{1D4B5}", zscr: "\u{1D4CF}", zwj: "\u200D", zwnj: "\u200C" };
  }
});

// node_modules/markdown-it/lib/common/entities.js
var require_entities2 = __commonJS({
  "node_modules/markdown-it/lib/common/entities.js"(exports, module) {
    module.exports = require_entities();
  }
});

// node_modules/uc.micro/categories/P/regex.js
var require_regex = __commonJS({
  "node_modules/uc.micro/categories/P/regex.js"(exports, module) {
    module.exports = /[!-#%-\*,-\/:;\?@\[-\]_\{\}\xA1\xA7\xAB\xB6\xB7\xBB\xBF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4E\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]|\uD800[\uDD00-\uDD02\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD803[\uDF55-\uDF59]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDDF\uDE38-\uDE3D\uDEA9]|\uD805[\uDC4B-\uDC4F\uDC5B\uDC5D\uDCC6\uDDC1-\uDDD7\uDE41-\uDE43\uDE60-\uDE6C\uDF3C-\uDF3E]|\uD806[\uDC3B\uDE3F-\uDE46\uDE9A-\uDE9C\uDE9E-\uDEA2]|\uD807[\uDC41-\uDC45\uDC70\uDC71\uDEF7\uDEF8]|\uD809[\uDC70-\uDC74]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3B\uDF44]|\uD81B[\uDE97-\uDE9A]|\uD82F\uDC9F|\uD836[\uDE87-\uDE8B]|\uD83A[\uDD5E\uDD5F]/;
  }
});

// node_modules/mdurl/encode.js
var require_encode = __commonJS({
  "node_modules/mdurl/encode.js"(exports, module) {
    var encodeCache = {};
    function getEncodeCache(exclude) {
      var i, ch, cache = encodeCache[exclude];
      if (cache) {
        return cache;
      }
      cache = encodeCache[exclude] = [];
      for (i = 0; i < 128; i++) {
        ch = String.fromCharCode(i);
        if (/^[0-9a-z]$/i.test(ch)) {
          cache.push(ch);
        } else {
          cache.push("%" + ("0" + i.toString(16).toUpperCase()).slice(-2));
        }
      }
      for (i = 0; i < exclude.length; i++) {
        cache[exclude.charCodeAt(i)] = exclude[i];
      }
      return cache;
    }
    function encode(string, exclude, keepEscaped) {
      var i, l, code2, nextCode, cache, result = "";
      if (typeof exclude !== "string") {
        keepEscaped = exclude;
        exclude = encode.defaultChars;
      }
      if (typeof keepEscaped === "undefined") {
        keepEscaped = true;
      }
      cache = getEncodeCache(exclude);
      for (i = 0, l = string.length; i < l; i++) {
        code2 = string.charCodeAt(i);
        if (keepEscaped && code2 === 37 && i + 2 < l) {
          if (/^[0-9a-f]{2}$/i.test(string.slice(i + 1, i + 3))) {
            result += string.slice(i, i + 3);
            i += 2;
            continue;
          }
        }
        if (code2 < 128) {
          result += cache[code2];
          continue;
        }
        if (code2 >= 55296 && code2 <= 57343) {
          if (code2 >= 55296 && code2 <= 56319 && i + 1 < l) {
            nextCode = string.charCodeAt(i + 1);
            if (nextCode >= 56320 && nextCode <= 57343) {
              result += encodeURIComponent(string[i] + string[i + 1]);
              i++;
              continue;
            }
          }
          result += "%EF%BF%BD";
          continue;
        }
        result += encodeURIComponent(string[i]);
      }
      return result;
    }
    encode.defaultChars = ";/?:@&=+$,-_.!~*'()#";
    encode.componentChars = "-_.!~*'()";
    module.exports = encode;
  }
});

// node_modules/mdurl/decode.js
var require_decode = __commonJS({
  "node_modules/mdurl/decode.js"(exports, module) {
    var decodeCache = {};
    function getDecodeCache(exclude) {
      var i, ch, cache = decodeCache[exclude];
      if (cache) {
        return cache;
      }
      cache = decodeCache[exclude] = [];
      for (i = 0; i < 128; i++) {
        ch = String.fromCharCode(i);
        cache.push(ch);
      }
      for (i = 0; i < exclude.length; i++) {
        ch = exclude.charCodeAt(i);
        cache[ch] = "%" + ("0" + ch.toString(16).toUpperCase()).slice(-2);
      }
      return cache;
    }
    function decode(string, exclude) {
      var cache;
      if (typeof exclude !== "string") {
        exclude = decode.defaultChars;
      }
      cache = getDecodeCache(exclude);
      return string.replace(/(%[a-f0-9]{2})+/gi, function(seq) {
        var i, l, b1, b2, b3, b4, chr, result = "";
        for (i = 0, l = seq.length; i < l; i += 3) {
          b1 = parseInt(seq.slice(i + 1, i + 3), 16);
          if (b1 < 128) {
            result += cache[b1];
            continue;
          }
          if ((b1 & 224) === 192 && i + 3 < l) {
            b2 = parseInt(seq.slice(i + 4, i + 6), 16);
            if ((b2 & 192) === 128) {
              chr = b1 << 6 & 1984 | b2 & 63;
              if (chr < 128) {
                result += "\uFFFD\uFFFD";
              } else {
                result += String.fromCharCode(chr);
              }
              i += 3;
              continue;
            }
          }
          if ((b1 & 240) === 224 && i + 6 < l) {
            b2 = parseInt(seq.slice(i + 4, i + 6), 16);
            b3 = parseInt(seq.slice(i + 7, i + 9), 16);
            if ((b2 & 192) === 128 && (b3 & 192) === 128) {
              chr = b1 << 12 & 61440 | b2 << 6 & 4032 | b3 & 63;
              if (chr < 2048 || chr >= 55296 && chr <= 57343) {
                result += "\uFFFD\uFFFD\uFFFD";
              } else {
                result += String.fromCharCode(chr);
              }
              i += 6;
              continue;
            }
          }
          if ((b1 & 248) === 240 && i + 9 < l) {
            b2 = parseInt(seq.slice(i + 4, i + 6), 16);
            b3 = parseInt(seq.slice(i + 7, i + 9), 16);
            b4 = parseInt(seq.slice(i + 10, i + 12), 16);
            if ((b2 & 192) === 128 && (b3 & 192) === 128 && (b4 & 192) === 128) {
              chr = b1 << 18 & 1835008 | b2 << 12 & 258048 | b3 << 6 & 4032 | b4 & 63;
              if (chr < 65536 || chr > 1114111) {
                result += "\uFFFD\uFFFD\uFFFD\uFFFD";
              } else {
                chr -= 65536;
                result += String.fromCharCode(55296 + (chr >> 10), 56320 + (chr & 1023));
              }
              i += 9;
              continue;
            }
          }
          result += "\uFFFD";
        }
        return result;
      });
    }
    decode.defaultChars = ";/?:@&=+$,#";
    decode.componentChars = "";
    module.exports = decode;
  }
});

// node_modules/mdurl/format.js
var require_format = __commonJS({
  "node_modules/mdurl/format.js"(exports, module) {
    module.exports = function format2(url) {
      var result = "";
      result += url.protocol || "";
      result += url.slashes ? "//" : "";
      result += url.auth ? url.auth + "@" : "";
      if (url.hostname && url.hostname.indexOf(":") !== -1) {
        result += "[" + url.hostname + "]";
      } else {
        result += url.hostname || "";
      }
      result += url.port ? ":" + url.port : "";
      result += url.pathname || "";
      result += url.search || "";
      result += url.hash || "";
      return result;
    };
  }
});

// node_modules/mdurl/parse.js
var require_parse = __commonJS({
  "node_modules/mdurl/parse.js"(exports, module) {
    function Url() {
      this.protocol = null;
      this.slashes = null;
      this.auth = null;
      this.port = null;
      this.hostname = null;
      this.hash = null;
      this.search = null;
      this.pathname = null;
    }
    var protocolPattern = /^([a-z0-9.+-]+:)/i;
    var portPattern = /:[0-9]*$/;
    var simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/;
    var delims = ["<", ">", '"', "`", " ", "\r", "\n", "	"];
    var unwise = ["{", "}", "|", "\\", "^", "`"].concat(delims);
    var autoEscape = ["'"].concat(unwise);
    var nonHostChars = ["%", "/", "?", ";", "#"].concat(autoEscape);
    var hostEndingChars = ["/", "?", "#"];
    var hostnameMaxLen = 255;
    var hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/;
    var hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/;
    var hostlessProtocol = {
      "javascript": true,
      "javascript:": true
    };
    var slashedProtocol = {
      "http": true,
      "https": true,
      "ftp": true,
      "gopher": true,
      "file": true,
      "http:": true,
      "https:": true,
      "ftp:": true,
      "gopher:": true,
      "file:": true
    };
    function urlParse(url, slashesDenoteHost) {
      if (url && url instanceof Url) {
        return url;
      }
      var u = new Url();
      u.parse(url, slashesDenoteHost);
      return u;
    }
    Url.prototype.parse = function(url, slashesDenoteHost) {
      var i, l, lowerProto, hec, slashes, rest = url;
      rest = rest.trim();
      if (!slashesDenoteHost && url.split("#").length === 1) {
        var simplePath = simplePathPattern.exec(rest);
        if (simplePath) {
          this.pathname = simplePath[1];
          if (simplePath[2]) {
            this.search = simplePath[2];
          }
          return this;
        }
      }
      var proto = protocolPattern.exec(rest);
      if (proto) {
        proto = proto[0];
        lowerProto = proto.toLowerCase();
        this.protocol = proto;
        rest = rest.substr(proto.length);
      }
      if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
        slashes = rest.substr(0, 2) === "//";
        if (slashes && !(proto && hostlessProtocol[proto])) {
          rest = rest.substr(2);
          this.slashes = true;
        }
      }
      if (!hostlessProtocol[proto] && (slashes || proto && !slashedProtocol[proto])) {
        var hostEnd = -1;
        for (i = 0; i < hostEndingChars.length; i++) {
          hec = rest.indexOf(hostEndingChars[i]);
          if (hec !== -1 && (hostEnd === -1 || hec < hostEnd)) {
            hostEnd = hec;
          }
        }
        var auth, atSign;
        if (hostEnd === -1) {
          atSign = rest.lastIndexOf("@");
        } else {
          atSign = rest.lastIndexOf("@", hostEnd);
        }
        if (atSign !== -1) {
          auth = rest.slice(0, atSign);
          rest = rest.slice(atSign + 1);
          this.auth = auth;
        }
        hostEnd = -1;
        for (i = 0; i < nonHostChars.length; i++) {
          hec = rest.indexOf(nonHostChars[i]);
          if (hec !== -1 && (hostEnd === -1 || hec < hostEnd)) {
            hostEnd = hec;
          }
        }
        if (hostEnd === -1) {
          hostEnd = rest.length;
        }
        if (rest[hostEnd - 1] === ":") {
          hostEnd--;
        }
        var host = rest.slice(0, hostEnd);
        rest = rest.slice(hostEnd);
        this.parseHost(host);
        this.hostname = this.hostname || "";
        var ipv6Hostname = this.hostname[0] === "[" && this.hostname[this.hostname.length - 1] === "]";
        if (!ipv6Hostname) {
          var hostparts = this.hostname.split(/\./);
          for (i = 0, l = hostparts.length; i < l; i++) {
            var part = hostparts[i];
            if (!part) {
              continue;
            }
            if (!part.match(hostnamePartPattern)) {
              var newpart = "";
              for (var j = 0, k = part.length; j < k; j++) {
                if (part.charCodeAt(j) > 127) {
                  newpart += "x";
                } else {
                  newpart += part[j];
                }
              }
              if (!newpart.match(hostnamePartPattern)) {
                var validParts = hostparts.slice(0, i);
                var notHost = hostparts.slice(i + 1);
                var bit = part.match(hostnamePartStart);
                if (bit) {
                  validParts.push(bit[1]);
                  notHost.unshift(bit[2]);
                }
                if (notHost.length) {
                  rest = notHost.join(".") + rest;
                }
                this.hostname = validParts.join(".");
                break;
              }
            }
          }
        }
        if (this.hostname.length > hostnameMaxLen) {
          this.hostname = "";
        }
        if (ipv6Hostname) {
          this.hostname = this.hostname.substr(1, this.hostname.length - 2);
        }
      }
      var hash = rest.indexOf("#");
      if (hash !== -1) {
        this.hash = rest.substr(hash);
        rest = rest.slice(0, hash);
      }
      var qm = rest.indexOf("?");
      if (qm !== -1) {
        this.search = rest.substr(qm);
        rest = rest.slice(0, qm);
      }
      if (rest) {
        this.pathname = rest;
      }
      if (slashedProtocol[lowerProto] && this.hostname && !this.pathname) {
        this.pathname = "";
      }
      return this;
    };
    Url.prototype.parseHost = function(host) {
      var port = portPattern.exec(host);
      if (port) {
        port = port[0];
        if (port !== ":") {
          this.port = port.substr(1);
        }
        host = host.substr(0, host.length - port.length);
      }
      if (host) {
        this.hostname = host;
      }
    };
    module.exports = urlParse;
  }
});

// node_modules/mdurl/index.js
var require_mdurl = __commonJS({
  "node_modules/mdurl/index.js"(exports, module) {
    module.exports.encode = require_encode();
    module.exports.decode = require_decode();
    module.exports.format = require_format();
    module.exports.parse = require_parse();
  }
});

// node_modules/uc.micro/properties/Any/regex.js
var require_regex2 = __commonJS({
  "node_modules/uc.micro/properties/Any/regex.js"(exports, module) {
    module.exports = /[\0-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  }
});

// node_modules/uc.micro/categories/Cc/regex.js
var require_regex3 = __commonJS({
  "node_modules/uc.micro/categories/Cc/regex.js"(exports, module) {
    module.exports = /[\0-\x1F\x7F-\x9F]/;
  }
});

// node_modules/uc.micro/categories/Cf/regex.js
var require_regex4 = __commonJS({
  "node_modules/uc.micro/categories/Cf/regex.js"(exports, module) {
    module.exports = /[\xAD\u0600-\u0605\u061C\u06DD\u070F\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]|\uD804[\uDCBD\uDCCD]|\uD82F[\uDCA0-\uDCA3]|\uD834[\uDD73-\uDD7A]|\uDB40[\uDC01\uDC20-\uDC7F]/;
  }
});

// node_modules/uc.micro/categories/Z/regex.js
var require_regex5 = __commonJS({
  "node_modules/uc.micro/categories/Z/regex.js"(exports, module) {
    module.exports = /[ \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;
  }
});

// node_modules/uc.micro/index.js
var require_uc = __commonJS({
  "node_modules/uc.micro/index.js"(exports) {
    exports.Any = require_regex2();
    exports.Cc = require_regex3();
    exports.Cf = require_regex4();
    exports.P = require_regex();
    exports.Z = require_regex5();
  }
});

// node_modules/markdown-it/lib/common/utils.js
var require_utils = __commonJS({
  "node_modules/markdown-it/lib/common/utils.js"(exports) {
    function _class(obj) {
      return Object.prototype.toString.call(obj);
    }
    function isString(obj) {
      return _class(obj) === "[object String]";
    }
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    function has(object, key) {
      return _hasOwnProperty.call(object, key);
    }
    function assign(obj) {
      var sources = Array.prototype.slice.call(arguments, 1);
      sources.forEach(function(source) {
        if (!source) {
          return;
        }
        if (typeof source !== "object") {
          throw new TypeError(source + "must be object");
        }
        Object.keys(source).forEach(function(key) {
          obj[key] = source[key];
        });
      });
      return obj;
    }
    function arrayReplaceAt(src, pos, newElements) {
      return [].concat(src.slice(0, pos), newElements, src.slice(pos + 1));
    }
    function isValidEntityCode(c) {
      if (c >= 55296 && c <= 57343) {
        return false;
      }
      if (c >= 64976 && c <= 65007) {
        return false;
      }
      if ((c & 65535) === 65535 || (c & 65535) === 65534) {
        return false;
      }
      if (c >= 0 && c <= 8) {
        return false;
      }
      if (c === 11) {
        return false;
      }
      if (c >= 14 && c <= 31) {
        return false;
      }
      if (c >= 127 && c <= 159) {
        return false;
      }
      if (c > 1114111) {
        return false;
      }
      return true;
    }
    function fromCodePoint(c) {
      if (c > 65535) {
        c -= 65536;
        var surrogate1 = 55296 + (c >> 10), surrogate2 = 56320 + (c & 1023);
        return String.fromCharCode(surrogate1, surrogate2);
      }
      return String.fromCharCode(c);
    }
    var UNESCAPE_MD_RE = /\\([!"#$%&'()*+,\-.\/:;<=>?@[\\\]^_`{|}~])/g;
    var ENTITY_RE = /&([a-z#][a-z0-9]{1,31});/gi;
    var UNESCAPE_ALL_RE = new RegExp(UNESCAPE_MD_RE.source + "|" + ENTITY_RE.source, "gi");
    var DIGITAL_ENTITY_TEST_RE = /^#((?:x[a-f0-9]{1,8}|[0-9]{1,8}))/i;
    var entities = require_entities2();
    function replaceEntityPattern(match, name) {
      var code2 = 0;
      if (has(entities, name)) {
        return entities[name];
      }
      if (name.charCodeAt(0) === 35 && DIGITAL_ENTITY_TEST_RE.test(name)) {
        code2 = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        if (isValidEntityCode(code2)) {
          return fromCodePoint(code2);
        }
      }
      return match;
    }
    function unescapeMd(str) {
      if (str.indexOf("\\") < 0) {
        return str;
      }
      return str.replace(UNESCAPE_MD_RE, "$1");
    }
    function unescapeAll(str) {
      if (str.indexOf("\\") < 0 && str.indexOf("&") < 0) {
        return str;
      }
      return str.replace(UNESCAPE_ALL_RE, function(match, escaped, entity) {
        if (escaped) {
          return escaped;
        }
        return replaceEntityPattern(match, entity);
      });
    }
    var HTML_ESCAPE_TEST_RE = /[&<>"]/;
    var HTML_ESCAPE_REPLACE_RE = /[&<>"]/g;
    var HTML_REPLACEMENTS = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    };
    function replaceUnsafeChar(ch) {
      return HTML_REPLACEMENTS[ch];
    }
    function escapeHtml2(str) {
      if (HTML_ESCAPE_TEST_RE.test(str)) {
        return str.replace(HTML_ESCAPE_REPLACE_RE, replaceUnsafeChar);
      }
      return str;
    }
    var REGEXP_ESCAPE_RE = /[.?*+^$[\]\\(){}|-]/g;
    function escapeRE(str) {
      return str.replace(REGEXP_ESCAPE_RE, "\\$&");
    }
    function isSpace(code2) {
      switch (code2) {
        case 9:
        case 32:
          return true;
      }
      return false;
    }
    function isWhiteSpace(code2) {
      if (code2 >= 8192 && code2 <= 8202) {
        return true;
      }
      switch (code2) {
        case 9:
        case 10:
        case 11:
        case 12:
        case 13:
        case 32:
        case 160:
        case 5760:
        case 8239:
        case 8287:
        case 12288:
          return true;
      }
      return false;
    }
    var UNICODE_PUNCT_RE = require_regex();
    function isPunctChar(ch) {
      return UNICODE_PUNCT_RE.test(ch);
    }
    function isMdAsciiPunct(ch) {
      switch (ch) {
        case 33:
        case 34:
        case 35:
        case 36:
        case 37:
        case 38:
        case 39:
        case 40:
        case 41:
        case 42:
        case 43:
        case 44:
        case 45:
        case 46:
        case 47:
        case 58:
        case 59:
        case 60:
        case 61:
        case 62:
        case 63:
        case 64:
        case 91:
        case 92:
        case 93:
        case 94:
        case 95:
        case 96:
        case 123:
        case 124:
        case 125:
        case 126:
          return true;
        default:
          return false;
      }
    }
    function normalizeReference(str) {
      str = str.trim().replace(/\s+/g, " ");
      if ("\u1E9E".toLowerCase() === "\u1E7E") {
        str = str.replace(/ẞ/g, "\xDF");
      }
      return str.toLowerCase().toUpperCase();
    }
    exports.lib = {};
    exports.lib.mdurl = require_mdurl();
    exports.lib.ucmicro = require_uc();
    exports.assign = assign;
    exports.isString = isString;
    exports.has = has;
    exports.unescapeMd = unescapeMd;
    exports.unescapeAll = unescapeAll;
    exports.isValidEntityCode = isValidEntityCode;
    exports.fromCodePoint = fromCodePoint;
    exports.escapeHtml = escapeHtml2;
    exports.arrayReplaceAt = arrayReplaceAt;
    exports.isSpace = isSpace;
    exports.isWhiteSpace = isWhiteSpace;
    exports.isMdAsciiPunct = isMdAsciiPunct;
    exports.isPunctChar = isPunctChar;
    exports.escapeRE = escapeRE;
    exports.normalizeReference = normalizeReference;
  }
});

// node_modules/markdown-it/lib/helpers/parse_link_label.js
var require_parse_link_label = __commonJS({
  "node_modules/markdown-it/lib/helpers/parse_link_label.js"(exports, module) {
    module.exports = function parseLinkLabel(state, start, disableNested) {
      var level, found, marker, prevPos, labelEnd = -1, max2 = state.posMax, oldPos = state.pos;
      state.pos = start + 1;
      level = 1;
      while (state.pos < max2) {
        marker = state.src.charCodeAt(state.pos);
        if (marker === 93) {
          level--;
          if (level === 0) {
            found = true;
            break;
          }
        }
        prevPos = state.pos;
        state.md.inline.skipToken(state);
        if (marker === 91) {
          if (prevPos === state.pos - 1) {
            level++;
          } else if (disableNested) {
            state.pos = oldPos;
            return -1;
          }
        }
      }
      if (found) {
        labelEnd = state.pos;
      }
      state.pos = oldPos;
      return labelEnd;
    };
  }
});

// node_modules/markdown-it/lib/helpers/parse_link_destination.js
var require_parse_link_destination = __commonJS({
  "node_modules/markdown-it/lib/helpers/parse_link_destination.js"(exports, module) {
    var unescapeAll = require_utils().unescapeAll;
    module.exports = function parseLinkDestination(str, pos, max2) {
      var code2, level, lines = 0, start = pos, result = {
        ok: false,
        pos: 0,
        lines: 0,
        str: ""
      };
      if (str.charCodeAt(pos) === 60) {
        pos++;
        while (pos < max2) {
          code2 = str.charCodeAt(pos);
          if (code2 === 10) {
            return result;
          }
          if (code2 === 60) {
            return result;
          }
          if (code2 === 62) {
            result.pos = pos + 1;
            result.str = unescapeAll(str.slice(start + 1, pos));
            result.ok = true;
            return result;
          }
          if (code2 === 92 && pos + 1 < max2) {
            pos += 2;
            continue;
          }
          pos++;
        }
        return result;
      }
      level = 0;
      while (pos < max2) {
        code2 = str.charCodeAt(pos);
        if (code2 === 32) {
          break;
        }
        if (code2 < 32 || code2 === 127) {
          break;
        }
        if (code2 === 92 && pos + 1 < max2) {
          if (str.charCodeAt(pos + 1) === 32) {
            break;
          }
          pos += 2;
          continue;
        }
        if (code2 === 40) {
          level++;
          if (level > 32) {
            return result;
          }
        }
        if (code2 === 41) {
          if (level === 0) {
            break;
          }
          level--;
        }
        pos++;
      }
      if (start === pos) {
        return result;
      }
      if (level !== 0) {
        return result;
      }
      result.str = unescapeAll(str.slice(start, pos));
      result.lines = lines;
      result.pos = pos;
      result.ok = true;
      return result;
    };
  }
});

// node_modules/markdown-it/lib/helpers/parse_link_title.js
var require_parse_link_title = __commonJS({
  "node_modules/markdown-it/lib/helpers/parse_link_title.js"(exports, module) {
    var unescapeAll = require_utils().unescapeAll;
    module.exports = function parseLinkTitle(str, pos, max2) {
      var code2, marker, lines = 0, start = pos, result = {
        ok: false,
        pos: 0,
        lines: 0,
        str: ""
      };
      if (pos >= max2) {
        return result;
      }
      marker = str.charCodeAt(pos);
      if (marker !== 34 && marker !== 39 && marker !== 40) {
        return result;
      }
      pos++;
      if (marker === 40) {
        marker = 41;
      }
      while (pos < max2) {
        code2 = str.charCodeAt(pos);
        if (code2 === marker) {
          result.pos = pos + 1;
          result.lines = lines;
          result.str = unescapeAll(str.slice(start + 1, pos));
          result.ok = true;
          return result;
        } else if (code2 === 40 && marker === 41) {
          return result;
        } else if (code2 === 10) {
          lines++;
        } else if (code2 === 92 && pos + 1 < max2) {
          pos++;
          if (str.charCodeAt(pos) === 10) {
            lines++;
          }
        }
        pos++;
      }
      return result;
    };
  }
});

// node_modules/markdown-it/lib/helpers/index.js
var require_helpers = __commonJS({
  "node_modules/markdown-it/lib/helpers/index.js"(exports) {
    exports.parseLinkLabel = require_parse_link_label();
    exports.parseLinkDestination = require_parse_link_destination();
    exports.parseLinkTitle = require_parse_link_title();
  }
});

// node_modules/markdown-it/lib/renderer.js
var require_renderer = __commonJS({
  "node_modules/markdown-it/lib/renderer.js"(exports, module) {
    var assign = require_utils().assign;
    var unescapeAll = require_utils().unescapeAll;
    var escapeHtml2 = require_utils().escapeHtml;
    var default_rules = {};
    default_rules.code_inline = function(tokens, idx, options, env, slf) {
      var token = tokens[idx];
      return "<code" + slf.renderAttrs(token) + ">" + escapeHtml2(tokens[idx].content) + "</code>";
    };
    default_rules.code_block = function(tokens, idx, options, env, slf) {
      var token = tokens[idx];
      return "<pre" + slf.renderAttrs(token) + "><code>" + escapeHtml2(tokens[idx].content) + "</code></pre>\n";
    };
    default_rules.fence = function(tokens, idx, options, env, slf) {
      var token = tokens[idx], info = token.info ? unescapeAll(token.info).trim() : "", langName = "", langAttrs = "", highlighted, i, arr, tmpAttrs, tmpToken;
      if (info) {
        arr = info.split(/(\s+)/g);
        langName = arr[0];
        langAttrs = arr.slice(2).join("");
      }
      if (options.highlight) {
        highlighted = options.highlight(token.content, langName, langAttrs) || escapeHtml2(token.content);
      } else {
        highlighted = escapeHtml2(token.content);
      }
      if (highlighted.indexOf("<pre") === 0) {
        return highlighted + "\n";
      }
      if (info) {
        i = token.attrIndex("class");
        tmpAttrs = token.attrs ? token.attrs.slice() : [];
        if (i < 0) {
          tmpAttrs.push(["class", options.langPrefix + langName]);
        } else {
          tmpAttrs[i] = tmpAttrs[i].slice();
          tmpAttrs[i][1] += " " + options.langPrefix + langName;
        }
        tmpToken = {
          attrs: tmpAttrs
        };
        return "<pre><code" + slf.renderAttrs(tmpToken) + ">" + highlighted + "</code></pre>\n";
      }
      return "<pre><code" + slf.renderAttrs(token) + ">" + highlighted + "</code></pre>\n";
    };
    default_rules.image = function(tokens, idx, options, env, slf) {
      var token = tokens[idx];
      token.attrs[token.attrIndex("alt")][1] = slf.renderInlineAsText(token.children, options, env);
      return slf.renderToken(tokens, idx, options);
    };
    default_rules.hardbreak = function(tokens, idx, options) {
      return options.xhtmlOut ? "<br />\n" : "<br>\n";
    };
    default_rules.softbreak = function(tokens, idx, options) {
      return options.breaks ? options.xhtmlOut ? "<br />\n" : "<br>\n" : "\n";
    };
    default_rules.text = function(tokens, idx) {
      return escapeHtml2(tokens[idx].content);
    };
    default_rules.html_block = function(tokens, idx) {
      return tokens[idx].content;
    };
    default_rules.html_inline = function(tokens, idx) {
      return tokens[idx].content;
    };
    function Renderer() {
      this.rules = assign({}, default_rules);
    }
    Renderer.prototype.renderAttrs = function renderAttrs(token) {
      var i, l, result;
      if (!token.attrs) {
        return "";
      }
      result = "";
      for (i = 0, l = token.attrs.length; i < l; i++) {
        result += " " + escapeHtml2(token.attrs[i][0]) + '="' + escapeHtml2(token.attrs[i][1]) + '"';
      }
      return result;
    };
    Renderer.prototype.renderToken = function renderToken(tokens, idx, options) {
      var nextToken, result = "", needLf = false, token = tokens[idx];
      if (token.hidden) {
        return "";
      }
      if (token.block && token.nesting !== -1 && idx && tokens[idx - 1].hidden) {
        result += "\n";
      }
      result += (token.nesting === -1 ? "</" : "<") + token.tag;
      result += this.renderAttrs(token);
      if (token.nesting === 0 && options.xhtmlOut) {
        result += " /";
      }
      if (token.block) {
        needLf = true;
        if (token.nesting === 1) {
          if (idx + 1 < tokens.length) {
            nextToken = tokens[idx + 1];
            if (nextToken.type === "inline" || nextToken.hidden) {
              needLf = false;
            } else if (nextToken.nesting === -1 && nextToken.tag === token.tag) {
              needLf = false;
            }
          }
        }
      }
      result += needLf ? ">\n" : ">";
      return result;
    };
    Renderer.prototype.renderInline = function(tokens, options, env) {
      var type, result = "", rules = this.rules;
      for (var i = 0, len = tokens.length; i < len; i++) {
        type = tokens[i].type;
        if (typeof rules[type] !== "undefined") {
          result += rules[type](tokens, i, options, env, this);
        } else {
          result += this.renderToken(tokens, i, options);
        }
      }
      return result;
    };
    Renderer.prototype.renderInlineAsText = function(tokens, options, env) {
      var result = "";
      for (var i = 0, len = tokens.length; i < len; i++) {
        if (tokens[i].type === "text") {
          result += tokens[i].content;
        } else if (tokens[i].type === "image") {
          result += this.renderInlineAsText(tokens[i].children, options, env);
        } else if (tokens[i].type === "softbreak") {
          result += "\n";
        }
      }
      return result;
    };
    Renderer.prototype.render = function(tokens, options, env) {
      var i, len, type, result = "", rules = this.rules;
      for (i = 0, len = tokens.length; i < len; i++) {
        type = tokens[i].type;
        if (type === "inline") {
          result += this.renderInline(tokens[i].children, options, env);
        } else if (typeof rules[type] !== "undefined") {
          result += rules[tokens[i].type](tokens, i, options, env, this);
        } else {
          result += this.renderToken(tokens, i, options, env);
        }
      }
      return result;
    };
    module.exports = Renderer;
  }
});

// node_modules/markdown-it/lib/ruler.js
var require_ruler = __commonJS({
  "node_modules/markdown-it/lib/ruler.js"(exports, module) {
    function Ruler() {
      this.__rules__ = [];
      this.__cache__ = null;
    }
    Ruler.prototype.__find__ = function(name) {
      for (var i = 0; i < this.__rules__.length; i++) {
        if (this.__rules__[i].name === name) {
          return i;
        }
      }
      return -1;
    };
    Ruler.prototype.__compile__ = function() {
      var self = this;
      var chains = [""];
      self.__rules__.forEach(function(rule) {
        if (!rule.enabled) {
          return;
        }
        rule.alt.forEach(function(altName) {
          if (chains.indexOf(altName) < 0) {
            chains.push(altName);
          }
        });
      });
      self.__cache__ = {};
      chains.forEach(function(chain) {
        self.__cache__[chain] = [];
        self.__rules__.forEach(function(rule) {
          if (!rule.enabled) {
            return;
          }
          if (chain && rule.alt.indexOf(chain) < 0) {
            return;
          }
          self.__cache__[chain].push(rule.fn);
        });
      });
    };
    Ruler.prototype.at = function(name, fn, options) {
      var index = this.__find__(name);
      var opt = options || {};
      if (index === -1) {
        throw new Error("Parser rule not found: " + name);
      }
      this.__rules__[index].fn = fn;
      this.__rules__[index].alt = opt.alt || [];
      this.__cache__ = null;
    };
    Ruler.prototype.before = function(beforeName, ruleName, fn, options) {
      var index = this.__find__(beforeName);
      var opt = options || {};
      if (index === -1) {
        throw new Error("Parser rule not found: " + beforeName);
      }
      this.__rules__.splice(index, 0, {
        name: ruleName,
        enabled: true,
        fn,
        alt: opt.alt || []
      });
      this.__cache__ = null;
    };
    Ruler.prototype.after = function(afterName, ruleName, fn, options) {
      var index = this.__find__(afterName);
      var opt = options || {};
      if (index === -1) {
        throw new Error("Parser rule not found: " + afterName);
      }
      this.__rules__.splice(index + 1, 0, {
        name: ruleName,
        enabled: true,
        fn,
        alt: opt.alt || []
      });
      this.__cache__ = null;
    };
    Ruler.prototype.push = function(ruleName, fn, options) {
      var opt = options || {};
      this.__rules__.push({
        name: ruleName,
        enabled: true,
        fn,
        alt: opt.alt || []
      });
      this.__cache__ = null;
    };
    Ruler.prototype.enable = function(list2, ignoreInvalid) {
      if (!Array.isArray(list2)) {
        list2 = [list2];
      }
      var result = [];
      list2.forEach(function(name) {
        var idx = this.__find__(name);
        if (idx < 0) {
          if (ignoreInvalid) {
            return;
          }
          throw new Error("Rules manager: invalid rule name " + name);
        }
        this.__rules__[idx].enabled = true;
        result.push(name);
      }, this);
      this.__cache__ = null;
      return result;
    };
    Ruler.prototype.enableOnly = function(list2, ignoreInvalid) {
      if (!Array.isArray(list2)) {
        list2 = [list2];
      }
      this.__rules__.forEach(function(rule) {
        rule.enabled = false;
      });
      this.enable(list2, ignoreInvalid);
    };
    Ruler.prototype.disable = function(list2, ignoreInvalid) {
      if (!Array.isArray(list2)) {
        list2 = [list2];
      }
      var result = [];
      list2.forEach(function(name) {
        var idx = this.__find__(name);
        if (idx < 0) {
          if (ignoreInvalid) {
            return;
          }
          throw new Error("Rules manager: invalid rule name " + name);
        }
        this.__rules__[idx].enabled = false;
        result.push(name);
      }, this);
      this.__cache__ = null;
      return result;
    };
    Ruler.prototype.getRules = function(chainName) {
      if (this.__cache__ === null) {
        this.__compile__();
      }
      return this.__cache__[chainName] || [];
    };
    module.exports = Ruler;
  }
});

// node_modules/markdown-it/lib/rules_core/normalize.js
var require_normalize = __commonJS({
  "node_modules/markdown-it/lib/rules_core/normalize.js"(exports, module) {
    var NEWLINES_RE = /\r\n?|\n/g;
    var NULL_RE = /\0/g;
    module.exports = function normalize(state) {
      var str;
      str = state.src.replace(NEWLINES_RE, "\n");
      str = str.replace(NULL_RE, "\uFFFD");
      state.src = str;
    };
  }
});

// node_modules/markdown-it/lib/rules_core/block.js
var require_block = __commonJS({
  "node_modules/markdown-it/lib/rules_core/block.js"(exports, module) {
    module.exports = function block4(state) {
      var token;
      if (state.inlineMode) {
        token = new state.Token("inline", "", 0);
        token.content = state.src;
        token.map = [0, 1];
        token.children = [];
        state.tokens.push(token);
      } else {
        state.md.block.parse(state.src, state.md, state.env, state.tokens);
      }
    };
  }
});

// node_modules/markdown-it/lib/rules_core/inline.js
var require_inline = __commonJS({
  "node_modules/markdown-it/lib/rules_core/inline.js"(exports, module) {
    module.exports = function inline4(state) {
      var tokens = state.tokens, tok, i, l;
      for (i = 0, l = tokens.length; i < l; i++) {
        tok = tokens[i];
        if (tok.type === "inline") {
          state.md.inline.parse(tok.content, state.md, state.env, tok.children);
        }
      }
    };
  }
});

// node_modules/markdown-it/lib/rules_core/linkify.js
var require_linkify = __commonJS({
  "node_modules/markdown-it/lib/rules_core/linkify.js"(exports, module) {
    var arrayReplaceAt = require_utils().arrayReplaceAt;
    function isLinkOpen(str) {
      return /^<a[>\s]/i.test(str);
    }
    function isLinkClose(str) {
      return /^<\/a\s*>/i.test(str);
    }
    module.exports = function linkify(state) {
      var i, j, l, tokens, token, currentToken, nodes, ln, text2, pos, lastPos, level, htmlLinkLevel, url, fullUrl, urlText, blockTokens = state.tokens, links;
      if (!state.md.options.linkify) {
        return;
      }
      for (j = 0, l = blockTokens.length; j < l; j++) {
        if (blockTokens[j].type !== "inline" || !state.md.linkify.pretest(blockTokens[j].content)) {
          continue;
        }
        tokens = blockTokens[j].children;
        htmlLinkLevel = 0;
        for (i = tokens.length - 1; i >= 0; i--) {
          currentToken = tokens[i];
          if (currentToken.type === "link_close") {
            i--;
            while (tokens[i].level !== currentToken.level && tokens[i].type !== "link_open") {
              i--;
            }
            continue;
          }
          if (currentToken.type === "html_inline") {
            if (isLinkOpen(currentToken.content) && htmlLinkLevel > 0) {
              htmlLinkLevel--;
            }
            if (isLinkClose(currentToken.content)) {
              htmlLinkLevel++;
            }
          }
          if (htmlLinkLevel > 0) {
            continue;
          }
          if (currentToken.type === "text" && state.md.linkify.test(currentToken.content)) {
            text2 = currentToken.content;
            links = state.md.linkify.match(text2);
            nodes = [];
            level = currentToken.level;
            lastPos = 0;
            for (ln = 0; ln < links.length; ln++) {
              url = links[ln].url;
              fullUrl = state.md.normalizeLink(url);
              if (!state.md.validateLink(fullUrl)) {
                continue;
              }
              urlText = links[ln].text;
              if (!links[ln].schema) {
                urlText = state.md.normalizeLinkText("http://" + urlText).replace(/^http:\/\//, "");
              } else if (links[ln].schema === "mailto:" && !/^mailto:/i.test(urlText)) {
                urlText = state.md.normalizeLinkText("mailto:" + urlText).replace(/^mailto:/, "");
              } else {
                urlText = state.md.normalizeLinkText(urlText);
              }
              pos = links[ln].index;
              if (pos > lastPos) {
                token = new state.Token("text", "", 0);
                token.content = text2.slice(lastPos, pos);
                token.level = level;
                nodes.push(token);
              }
              token = new state.Token("link_open", "a", 1);
              token.attrs = [["href", fullUrl]];
              token.level = level++;
              token.markup = "linkify";
              token.info = "auto";
              nodes.push(token);
              token = new state.Token("text", "", 0);
              token.content = urlText;
              token.level = level;
              nodes.push(token);
              token = new state.Token("link_close", "a", -1);
              token.level = --level;
              token.markup = "linkify";
              token.info = "auto";
              nodes.push(token);
              lastPos = links[ln].lastIndex;
            }
            if (lastPos < text2.length) {
              token = new state.Token("text", "", 0);
              token.content = text2.slice(lastPos);
              token.level = level;
              nodes.push(token);
            }
            blockTokens[j].children = tokens = arrayReplaceAt(tokens, i, nodes);
          }
        }
      }
    };
  }
});

// node_modules/markdown-it/lib/rules_core/replacements.js
var require_replacements = __commonJS({
  "node_modules/markdown-it/lib/rules_core/replacements.js"(exports, module) {
    var RARE_RE = /\+-|\.\.|\?\?\?\?|!!!!|,,|--/;
    var SCOPED_ABBR_TEST_RE = /\((c|tm|r|p)\)/i;
    var SCOPED_ABBR_RE = /\((c|tm|r|p)\)/ig;
    var SCOPED_ABBR = {
      c: "\xA9",
      r: "\xAE",
      p: "\xA7",
      tm: "\u2122"
    };
    function replaceFn(match, name) {
      return SCOPED_ABBR[name.toLowerCase()];
    }
    function replace_scoped(inlineTokens) {
      var i, token, inside_autolink = 0;
      for (i = inlineTokens.length - 1; i >= 0; i--) {
        token = inlineTokens[i];
        if (token.type === "text" && !inside_autolink) {
          token.content = token.content.replace(SCOPED_ABBR_RE, replaceFn);
        }
        if (token.type === "link_open" && token.info === "auto") {
          inside_autolink--;
        }
        if (token.type === "link_close" && token.info === "auto") {
          inside_autolink++;
        }
      }
    }
    function replace_rare(inlineTokens) {
      var i, token, inside_autolink = 0;
      for (i = inlineTokens.length - 1; i >= 0; i--) {
        token = inlineTokens[i];
        if (token.type === "text" && !inside_autolink) {
          if (RARE_RE.test(token.content)) {
            token.content = token.content.replace(/\+-/g, "\xB1").replace(/\.{2,}/g, "\u2026").replace(/([?!])…/g, "$1..").replace(/([?!]){4,}/g, "$1$1$1").replace(/,{2,}/g, ",").replace(/(^|[^-])---(?=[^-]|$)/mg, "$1\u2014").replace(/(^|\s)--(?=\s|$)/mg, "$1\u2013").replace(/(^|[^-\s])--(?=[^-\s]|$)/mg, "$1\u2013");
          }
        }
        if (token.type === "link_open" && token.info === "auto") {
          inside_autolink--;
        }
        if (token.type === "link_close" && token.info === "auto") {
          inside_autolink++;
        }
      }
    }
    module.exports = function replace(state) {
      var blkIdx;
      if (!state.md.options.typographer) {
        return;
      }
      for (blkIdx = state.tokens.length - 1; blkIdx >= 0; blkIdx--) {
        if (state.tokens[blkIdx].type !== "inline") {
          continue;
        }
        if (SCOPED_ABBR_TEST_RE.test(state.tokens[blkIdx].content)) {
          replace_scoped(state.tokens[blkIdx].children);
        }
        if (RARE_RE.test(state.tokens[blkIdx].content)) {
          replace_rare(state.tokens[blkIdx].children);
        }
      }
    };
  }
});

// node_modules/markdown-it/lib/rules_core/smartquotes.js
var require_smartquotes = __commonJS({
  "node_modules/markdown-it/lib/rules_core/smartquotes.js"(exports, module) {
    var isWhiteSpace = require_utils().isWhiteSpace;
    var isPunctChar = require_utils().isPunctChar;
    var isMdAsciiPunct = require_utils().isMdAsciiPunct;
    var QUOTE_TEST_RE = /['"]/;
    var QUOTE_RE = /['"]/g;
    var APOSTROPHE = "\u2019";
    function replaceAt(str, index, ch) {
      return str.substr(0, index) + ch + str.substr(index + 1);
    }
    function process_inlines(tokens, state) {
      var i, token, text2, t, pos, max2, thisLevel, item2, lastChar, nextChar, isLastPunctChar, isNextPunctChar, isLastWhiteSpace, isNextWhiteSpace, canOpen, canClose, j, isSingle, stack, openQuote, closeQuote;
      stack = [];
      for (i = 0; i < tokens.length; i++) {
        token = tokens[i];
        thisLevel = tokens[i].level;
        for (j = stack.length - 1; j >= 0; j--) {
          if (stack[j].level <= thisLevel) {
            break;
          }
        }
        stack.length = j + 1;
        if (token.type !== "text") {
          continue;
        }
        text2 = token.content;
        pos = 0;
        max2 = text2.length;
        OUTER:
          while (pos < max2) {
            QUOTE_RE.lastIndex = pos;
            t = QUOTE_RE.exec(text2);
            if (!t) {
              break;
            }
            canOpen = canClose = true;
            pos = t.index + 1;
            isSingle = t[0] === "'";
            lastChar = 32;
            if (t.index - 1 >= 0) {
              lastChar = text2.charCodeAt(t.index - 1);
            } else {
              for (j = i - 1; j >= 0; j--) {
                if (tokens[j].type === "softbreak" || tokens[j].type === "hardbreak")
                  break;
                if (!tokens[j].content)
                  continue;
                lastChar = tokens[j].content.charCodeAt(tokens[j].content.length - 1);
                break;
              }
            }
            nextChar = 32;
            if (pos < max2) {
              nextChar = text2.charCodeAt(pos);
            } else {
              for (j = i + 1; j < tokens.length; j++) {
                if (tokens[j].type === "softbreak" || tokens[j].type === "hardbreak")
                  break;
                if (!tokens[j].content)
                  continue;
                nextChar = tokens[j].content.charCodeAt(0);
                break;
              }
            }
            isLastPunctChar = isMdAsciiPunct(lastChar) || isPunctChar(String.fromCharCode(lastChar));
            isNextPunctChar = isMdAsciiPunct(nextChar) || isPunctChar(String.fromCharCode(nextChar));
            isLastWhiteSpace = isWhiteSpace(lastChar);
            isNextWhiteSpace = isWhiteSpace(nextChar);
            if (isNextWhiteSpace) {
              canOpen = false;
            } else if (isNextPunctChar) {
              if (!(isLastWhiteSpace || isLastPunctChar)) {
                canOpen = false;
              }
            }
            if (isLastWhiteSpace) {
              canClose = false;
            } else if (isLastPunctChar) {
              if (!(isNextWhiteSpace || isNextPunctChar)) {
                canClose = false;
              }
            }
            if (nextChar === 34 && t[0] === '"') {
              if (lastChar >= 48 && lastChar <= 57) {
                canClose = canOpen = false;
              }
            }
            if (canOpen && canClose) {
              canOpen = isLastPunctChar;
              canClose = isNextPunctChar;
            }
            if (!canOpen && !canClose) {
              if (isSingle) {
                token.content = replaceAt(token.content, t.index, APOSTROPHE);
              }
              continue;
            }
            if (canClose) {
              for (j = stack.length - 1; j >= 0; j--) {
                item2 = stack[j];
                if (stack[j].level < thisLevel) {
                  break;
                }
                if (item2.single === isSingle && stack[j].level === thisLevel) {
                  item2 = stack[j];
                  if (isSingle) {
                    openQuote = state.md.options.quotes[2];
                    closeQuote = state.md.options.quotes[3];
                  } else {
                    openQuote = state.md.options.quotes[0];
                    closeQuote = state.md.options.quotes[1];
                  }
                  token.content = replaceAt(token.content, t.index, closeQuote);
                  tokens[item2.token].content = replaceAt(tokens[item2.token].content, item2.pos, openQuote);
                  pos += closeQuote.length - 1;
                  if (item2.token === i) {
                    pos += openQuote.length - 1;
                  }
                  text2 = token.content;
                  max2 = text2.length;
                  stack.length = j;
                  continue OUTER;
                }
              }
            }
            if (canOpen) {
              stack.push({
                token: i,
                pos: t.index,
                single: isSingle,
                level: thisLevel
              });
            } else if (canClose && isSingle) {
              token.content = replaceAt(token.content, t.index, APOSTROPHE);
            }
          }
      }
    }
    module.exports = function smartquotes(state) {
      var blkIdx;
      if (!state.md.options.typographer) {
        return;
      }
      for (blkIdx = state.tokens.length - 1; blkIdx >= 0; blkIdx--) {
        if (state.tokens[blkIdx].type !== "inline" || !QUOTE_TEST_RE.test(state.tokens[blkIdx].content)) {
          continue;
        }
        process_inlines(state.tokens[blkIdx].children, state);
      }
    };
  }
});

// node_modules/markdown-it/lib/token.js
var require_token = __commonJS({
  "node_modules/markdown-it/lib/token.js"(exports, module) {
    function Token(type, tag, nesting) {
      this.type = type;
      this.tag = tag;
      this.attrs = null;
      this.map = null;
      this.nesting = nesting;
      this.level = 0;
      this.children = null;
      this.content = "";
      this.markup = "";
      this.info = "";
      this.meta = null;
      this.block = false;
      this.hidden = false;
    }
    Token.prototype.attrIndex = function attrIndex(name) {
      var attrs, i, len;
      if (!this.attrs) {
        return -1;
      }
      attrs = this.attrs;
      for (i = 0, len = attrs.length; i < len; i++) {
        if (attrs[i][0] === name) {
          return i;
        }
      }
      return -1;
    };
    Token.prototype.attrPush = function attrPush(attrData) {
      if (this.attrs) {
        this.attrs.push(attrData);
      } else {
        this.attrs = [attrData];
      }
    };
    Token.prototype.attrSet = function attrSet(name, value) {
      var idx = this.attrIndex(name), attrData = [name, value];
      if (idx < 0) {
        this.attrPush(attrData);
      } else {
        this.attrs[idx] = attrData;
      }
    };
    Token.prototype.attrGet = function attrGet(name) {
      var idx = this.attrIndex(name), value = null;
      if (idx >= 0) {
        value = this.attrs[idx][1];
      }
      return value;
    };
    Token.prototype.attrJoin = function attrJoin(name, value) {
      var idx = this.attrIndex(name);
      if (idx < 0) {
        this.attrPush([name, value]);
      } else {
        this.attrs[idx][1] = this.attrs[idx][1] + " " + value;
      }
    };
    module.exports = Token;
  }
});

// node_modules/markdown-it/lib/rules_core/state_core.js
var require_state_core = __commonJS({
  "node_modules/markdown-it/lib/rules_core/state_core.js"(exports, module) {
    var Token = require_token();
    function StateCore(src, md, env) {
      this.src = src;
      this.env = env;
      this.tokens = [];
      this.inlineMode = false;
      this.md = md;
    }
    StateCore.prototype.Token = Token;
    module.exports = StateCore;
  }
});

// node_modules/markdown-it/lib/parser_core.js
var require_parser_core = __commonJS({
  "node_modules/markdown-it/lib/parser_core.js"(exports, module) {
    var Ruler = require_ruler();
    var _rules = [
      ["normalize", require_normalize()],
      ["block", require_block()],
      ["inline", require_inline()],
      ["linkify", require_linkify()],
      ["replacements", require_replacements()],
      ["smartquotes", require_smartquotes()]
    ];
    function Core() {
      this.ruler = new Ruler();
      for (var i = 0; i < _rules.length; i++) {
        this.ruler.push(_rules[i][0], _rules[i][1]);
      }
    }
    Core.prototype.process = function(state) {
      var i, l, rules;
      rules = this.ruler.getRules("");
      for (i = 0, l = rules.length; i < l; i++) {
        rules[i](state);
      }
    };
    Core.prototype.State = require_state_core();
    module.exports = Core;
  }
});

// node_modules/markdown-it/lib/rules_block/table.js
var require_table = __commonJS({
  "node_modules/markdown-it/lib/rules_block/table.js"(exports, module) {
    var isSpace = require_utils().isSpace;
    function getLine2(state, line) {
      var pos = state.bMarks[line] + state.tShift[line], max2 = state.eMarks[line];
      return state.src.substr(pos, max2 - pos);
    }
    function escapedSplit(str) {
      var result = [], pos = 0, max2 = str.length, ch, isEscaped = false, lastPos = 0, current = "";
      ch = str.charCodeAt(pos);
      while (pos < max2) {
        if (ch === 124) {
          if (!isEscaped) {
            result.push(current + str.substring(lastPos, pos));
            current = "";
            lastPos = pos + 1;
          } else {
            current += str.substring(lastPos, pos - 1);
            lastPos = pos;
          }
        }
        isEscaped = ch === 92;
        pos++;
        ch = str.charCodeAt(pos);
      }
      result.push(current + str.substring(lastPos));
      return result;
    }
    module.exports = function table3(state, startLine, endLine, silent) {
      var ch, lineText, pos, i, l, nextLine, columns, columnCount, token, aligns, t, tableLines, tbodyLines, oldParentType, terminate, terminatorRules, firstCh, secondCh;
      if (startLine + 2 > endLine) {
        return false;
      }
      nextLine = startLine + 1;
      if (state.sCount[nextLine] < state.blkIndent) {
        return false;
      }
      if (!state.md.options.allowIndentation && state.sCount[nextLine] - state.blkIndent >= 4) {
        return false;
      }
      pos = state.bMarks[nextLine] + state.tShift[nextLine];
      if (pos >= state.eMarks[nextLine]) {
        return false;
      }
      firstCh = state.src.charCodeAt(pos++);
      if (firstCh !== 124 && firstCh !== 45 && firstCh !== 58) {
        return false;
      }
      if (pos >= state.eMarks[nextLine]) {
        return false;
      }
      secondCh = state.src.charCodeAt(pos++);
      if (secondCh !== 124 && secondCh !== 45 && secondCh !== 58 && !isSpace(secondCh)) {
        return false;
      }
      if (firstCh === 45 && isSpace(secondCh)) {
        return false;
      }
      while (pos < state.eMarks[nextLine]) {
        ch = state.src.charCodeAt(pos);
        if (ch !== 124 && ch !== 45 && ch !== 58 && !isSpace(ch)) {
          return false;
        }
        pos++;
      }
      lineText = getLine2(state, startLine + 1);
      columns = lineText.split("|");
      aligns = [];
      for (i = 0; i < columns.length; i++) {
        t = columns[i].trim();
        if (!t) {
          if (i === 0 || i === columns.length - 1) {
            continue;
          } else {
            return false;
          }
        }
        if (!/^:?-+:?$/.test(t)) {
          return false;
        }
        if (t.charCodeAt(t.length - 1) === 58) {
          aligns.push(t.charCodeAt(0) === 58 ? "center" : "right");
        } else if (t.charCodeAt(0) === 58) {
          aligns.push("left");
        } else {
          aligns.push("");
        }
      }
      lineText = getLine2(state, startLine).trim();
      if (lineText.indexOf("|") === -1) {
        return false;
      }
      if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      columns = escapedSplit(lineText);
      if (columns.length && columns[0] === "")
        columns.shift();
      if (columns.length && columns[columns.length - 1] === "")
        columns.pop();
      columnCount = columns.length;
      if (columnCount === 0 || columnCount !== aligns.length) {
        return false;
      }
      if (silent) {
        return true;
      }
      oldParentType = state.parentType;
      state.parentType = "table";
      terminatorRules = state.md.block.ruler.getRules("blockquote");
      token = state.push("table_open", "table", 1);
      token.map = tableLines = [startLine, 0];
      token = state.push("thead_open", "thead", 1);
      token.map = [startLine, startLine + 1];
      token = state.push("tr_open", "tr", 1);
      token.map = [startLine, startLine + 1];
      for (i = 0; i < columns.length; i++) {
        token = state.push("th_open", "th", 1);
        if (aligns[i]) {
          token.attrs = [["style", "text-align:" + aligns[i]]];
        }
        token = state.push("inline", "", 0);
        token.content = columns[i].trim();
        token.children = [];
        token = state.push("th_close", "th", -1);
      }
      token = state.push("tr_close", "tr", -1);
      token = state.push("thead_close", "thead", -1);
      for (nextLine = startLine + 2; nextLine < endLine; nextLine++) {
        if (state.sCount[nextLine] < state.blkIndent) {
          break;
        }
        terminate = false;
        for (i = 0, l = terminatorRules.length; i < l; i++) {
          if (terminatorRules[i](state, nextLine, endLine, true)) {
            terminate = true;
            break;
          }
        }
        if (terminate) {
          break;
        }
        lineText = getLine2(state, nextLine).trim();
        if (!lineText) {
          break;
        }
        if (!state.md.options.allowIndentation && state.sCount[nextLine] - state.blkIndent >= 4) {
          break;
        }
        columns = escapedSplit(lineText);
        if (columns.length && columns[0] === "")
          columns.shift();
        if (columns.length && columns[columns.length - 1] === "")
          columns.pop();
        if (nextLine === startLine + 2) {
          token = state.push("tbody_open", "tbody", 1);
          token.map = tbodyLines = [startLine + 2, 0];
        }
        token = state.push("tr_open", "tr", 1);
        token.map = [nextLine, nextLine + 1];
        for (i = 0; i < columnCount; i++) {
          token = state.push("td_open", "td", 1);
          if (aligns[i]) {
            token.attrs = [["style", "text-align:" + aligns[i]]];
          }
          token = state.push("inline", "", 0);
          token.content = columns[i] ? columns[i].trim() : "";
          token.children = [];
          token = state.push("td_close", "td", -1);
        }
        token = state.push("tr_close", "tr", -1);
      }
      if (tbodyLines) {
        token = state.push("tbody_close", "tbody", -1);
        tbodyLines[1] = nextLine;
      }
      token = state.push("table_close", "table", -1);
      tableLines[1] = nextLine;
      state.parentType = oldParentType;
      state.line = nextLine;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/code.js
var require_code = __commonJS({
  "node_modules/markdown-it/lib/rules_block/code.js"(exports, module) {
    module.exports = function code2(state, startLine, endLine) {
      if (state.md.options.allowIndentation) {
        return false;
      }
      var nextLine, last, token;
      if (state.sCount[startLine] - state.blkIndent < 4) {
        return false;
      }
      last = nextLine = startLine + 1;
      while (nextLine < endLine) {
        if (state.isEmpty(nextLine)) {
          nextLine++;
          continue;
        }
        if (state.sCount[nextLine] - state.blkIndent >= 4) {
          nextLine++;
          last = nextLine;
          continue;
        }
        break;
      }
      state.line = last;
      token = state.push("code_block", "code", 0);
      token.content = state.getLines(startLine, last, 4 + state.blkIndent, false) + "\n";
      token.map = [startLine, state.line];
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/fence.js
var require_fence = __commonJS({
  "node_modules/markdown-it/lib/rules_block/fence.js"(exports, module) {
    module.exports = function fence3(state, startLine, endLine, silent) {
      var marker, len, params, nextLine, mem, token, markup, haveEndMarker = false, pos = state.bMarks[startLine] + state.tShift[startLine], max2 = state.eMarks[startLine];
      if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      if (pos + 3 > max2) {
        return false;
      }
      marker = state.src.charCodeAt(pos);
      if (marker !== 126 && marker !== 96) {
        return false;
      }
      mem = pos;
      pos = state.skipChars(pos, marker);
      len = pos - mem;
      if (len < 3) {
        return false;
      }
      markup = state.src.slice(mem, pos);
      params = state.src.slice(pos, max2);
      if (marker === 96) {
        if (params.indexOf(String.fromCharCode(marker)) >= 0) {
          return false;
        }
      }
      if (silent) {
        return true;
      }
      nextLine = startLine;
      for (; ; ) {
        nextLine++;
        if (nextLine >= endLine) {
          break;
        }
        pos = mem = state.bMarks[nextLine] + state.tShift[nextLine];
        max2 = state.eMarks[nextLine];
        if (pos < max2 && state.sCount[nextLine] < state.blkIndent) {
          break;
        }
        if (state.src.charCodeAt(pos) !== marker) {
          continue;
        }
        if (!state.md.options.allowIndentation && state.sCount[nextLine] - state.blkIndent >= 4) {
          continue;
        }
        pos = state.skipChars(pos, marker);
        if (pos - mem < len) {
          continue;
        }
        pos = state.skipSpaces(pos);
        if (pos < max2) {
          continue;
        }
        haveEndMarker = true;
        break;
      }
      len = state.sCount[startLine];
      state.line = nextLine + (haveEndMarker ? 1 : 0);
      token = state.push("fence", "code", 0);
      token.info = params;
      token.content = state.getLines(startLine + 1, nextLine, len, true);
      token.markup = markup;
      token.map = [startLine, state.line];
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/blockquote.js
var require_blockquote = __commonJS({
  "node_modules/markdown-it/lib/rules_block/blockquote.js"(exports, module) {
    var isSpace = require_utils().isSpace;
    module.exports = function blockquote2(state, startLine, endLine, silent) {
      var adjustTab, ch, i, initial, l, lastLineEmpty, lines, nextLine, offset, oldBMarks, oldBSCount, oldIndent, oldParentType, oldSCount, oldTShift, spaceAfterMarker, terminate, terminatorRules, token, isOutdented, oldLineMax = state.lineMax, pos = state.bMarks[startLine] + state.tShift[startLine], max2 = state.eMarks[startLine];
      if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      if (state.src.charCodeAt(pos++) !== 62) {
        return false;
      }
      if (silent) {
        return true;
      }
      initial = offset = state.sCount[startLine] + 1;
      if (state.src.charCodeAt(pos) === 32) {
        pos++;
        initial++;
        offset++;
        adjustTab = false;
        spaceAfterMarker = true;
      } else if (state.src.charCodeAt(pos) === 9) {
        spaceAfterMarker = true;
        if ((state.bsCount[startLine] + offset) % 4 === 3) {
          pos++;
          initial++;
          offset++;
          adjustTab = false;
        } else {
          adjustTab = true;
        }
      } else {
        spaceAfterMarker = false;
      }
      oldBMarks = [state.bMarks[startLine]];
      state.bMarks[startLine] = pos;
      while (pos < max2) {
        ch = state.src.charCodeAt(pos);
        if (isSpace(ch)) {
          if (ch === 9) {
            offset += 4 - (offset + state.bsCount[startLine] + (adjustTab ? 1 : 0)) % 4;
          } else {
            offset++;
          }
        } else {
          break;
        }
        pos++;
      }
      oldBSCount = [state.bsCount[startLine]];
      state.bsCount[startLine] = state.sCount[startLine] + 1 + (spaceAfterMarker ? 1 : 0);
      lastLineEmpty = pos >= max2;
      oldSCount = [state.sCount[startLine]];
      state.sCount[startLine] = offset - initial;
      oldTShift = [state.tShift[startLine]];
      state.tShift[startLine] = pos - state.bMarks[startLine];
      terminatorRules = state.md.block.ruler.getRules("blockquote");
      oldParentType = state.parentType;
      state.parentType = "blockquote";
      for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
        isOutdented = state.sCount[nextLine] < state.blkIndent;
        pos = state.bMarks[nextLine] + state.tShift[nextLine];
        max2 = state.eMarks[nextLine];
        if (pos >= max2) {
          break;
        }
        if (state.src.charCodeAt(pos++) === 62 && !isOutdented) {
          initial = offset = state.sCount[nextLine] + 1;
          if (state.src.charCodeAt(pos) === 32) {
            pos++;
            initial++;
            offset++;
            adjustTab = false;
            spaceAfterMarker = true;
          } else if (state.src.charCodeAt(pos) === 9) {
            spaceAfterMarker = true;
            if ((state.bsCount[nextLine] + offset) % 4 === 3) {
              pos++;
              initial++;
              offset++;
              adjustTab = false;
            } else {
              adjustTab = true;
            }
          } else {
            spaceAfterMarker = false;
          }
          oldBMarks.push(state.bMarks[nextLine]);
          state.bMarks[nextLine] = pos;
          while (pos < max2) {
            ch = state.src.charCodeAt(pos);
            if (isSpace(ch)) {
              if (ch === 9) {
                offset += 4 - (offset + state.bsCount[nextLine] + (adjustTab ? 1 : 0)) % 4;
              } else {
                offset++;
              }
            } else {
              break;
            }
            pos++;
          }
          lastLineEmpty = pos >= max2;
          oldBSCount.push(state.bsCount[nextLine]);
          state.bsCount[nextLine] = state.sCount[nextLine] + 1 + (spaceAfterMarker ? 1 : 0);
          oldSCount.push(state.sCount[nextLine]);
          state.sCount[nextLine] = offset - initial;
          oldTShift.push(state.tShift[nextLine]);
          state.tShift[nextLine] = pos - state.bMarks[nextLine];
          continue;
        }
        if (lastLineEmpty) {
          break;
        }
        terminate = false;
        for (i = 0, l = terminatorRules.length; i < l; i++) {
          if (terminatorRules[i](state, nextLine, endLine, true)) {
            terminate = true;
            break;
          }
        }
        if (terminate) {
          state.lineMax = nextLine;
          if (state.blkIndent !== 0) {
            oldBMarks.push(state.bMarks[nextLine]);
            oldBSCount.push(state.bsCount[nextLine]);
            oldTShift.push(state.tShift[nextLine]);
            oldSCount.push(state.sCount[nextLine]);
            state.sCount[nextLine] -= state.blkIndent;
          }
          break;
        }
        oldBMarks.push(state.bMarks[nextLine]);
        oldBSCount.push(state.bsCount[nextLine]);
        oldTShift.push(state.tShift[nextLine]);
        oldSCount.push(state.sCount[nextLine]);
        state.sCount[nextLine] = -1;
      }
      oldIndent = state.blkIndent;
      state.blkIndent = 0;
      token = state.push("blockquote_open", "blockquote", 1);
      token.markup = ">";
      token.map = lines = [startLine, 0];
      state.md.block.tokenize(state, startLine, nextLine);
      token = state.push("blockquote_close", "blockquote", -1);
      token.markup = ">";
      state.lineMax = oldLineMax;
      state.parentType = oldParentType;
      lines[1] = state.line;
      for (i = 0; i < oldTShift.length; i++) {
        state.bMarks[i + startLine] = oldBMarks[i];
        state.tShift[i + startLine] = oldTShift[i];
        state.sCount[i + startLine] = oldSCount[i];
        state.bsCount[i + startLine] = oldBSCount[i];
      }
      state.blkIndent = oldIndent;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/hr.js
var require_hr = __commonJS({
  "node_modules/markdown-it/lib/rules_block/hr.js"(exports, module) {
    var isSpace = require_utils().isSpace;
    module.exports = function hr2(state, startLine, endLine, silent) {
      var marker, cnt, ch, token, pos = state.bMarks[startLine] + state.tShift[startLine], max2 = state.eMarks[startLine];
      if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      marker = state.src.charCodeAt(pos++);
      if (marker !== 42 && marker !== 45 && marker !== 95) {
        return false;
      }
      cnt = 1;
      while (pos < max2) {
        ch = state.src.charCodeAt(pos++);
        if (ch !== marker && !isSpace(ch)) {
          return false;
        }
        if (ch === marker) {
          cnt++;
        }
      }
      if (cnt < 3) {
        return false;
      }
      if (silent) {
        return true;
      }
      state.line = startLine + 1;
      token = state.push("hr", "hr", 0);
      token.map = [startLine, state.line];
      token.markup = Array(cnt + 1).join(String.fromCharCode(marker));
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/list.js
var require_list = __commonJS({
  "node_modules/markdown-it/lib/rules_block/list.js"(exports, module) {
    var isSpace = require_utils().isSpace;
    function skipBulletListMarker(state, startLine) {
      var marker, pos, max2, ch;
      pos = state.bMarks[startLine] + state.tShift[startLine];
      max2 = state.eMarks[startLine];
      marker = state.src.charCodeAt(pos++);
      if (marker !== 42 && marker !== 45 && marker !== 43) {
        return -1;
      }
      if (pos < max2) {
        ch = state.src.charCodeAt(pos);
        if (!isSpace(ch)) {
          return -1;
        }
      }
      return pos;
    }
    function skipOrderedListMarker(state, startLine) {
      var ch, start = state.bMarks[startLine] + state.tShift[startLine], pos = start, max2 = state.eMarks[startLine];
      if (pos + 1 >= max2) {
        return -1;
      }
      ch = state.src.charCodeAt(pos++);
      if (ch < 48 || ch > 57) {
        return -1;
      }
      for (; ; ) {
        if (pos >= max2) {
          return -1;
        }
        ch = state.src.charCodeAt(pos++);
        if (ch >= 48 && ch <= 57) {
          if (pos - start >= 10) {
            return -1;
          }
          continue;
        }
        if (ch === 41 || ch === 46) {
          break;
        }
        return -1;
      }
      if (pos < max2) {
        ch = state.src.charCodeAt(pos);
        if (!isSpace(ch)) {
          return -1;
        }
      }
      return pos;
    }
    function markTightParagraphs(state, idx) {
      var i, l, level = state.level + 2;
      for (i = idx + 2, l = state.tokens.length - 2; i < l; i++) {
        if (state.tokens[i].level === level && state.tokens[i].type === "paragraph_open") {
          state.tokens[i + 2].hidden = true;
          state.tokens[i].hidden = true;
          i += 2;
        }
      }
    }
    module.exports = function list2(state, startLine, endLine, silent) {
      var ch, contentStart, i, indent, indentAfterMarker, initial, isOrdered, itemLines, l, listLines, listTokIdx, markerCharCode, markerValue, max2, nextLine, offset, oldListIndent, oldParentType, oldSCount, oldTShift, oldTight, pos, posAfterMarker, prevEmptyEnd, start, terminate, terminatorRules, token, isTerminatingParagraph = false, tight = true;
      if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      if (!state.md.options.allowIndentation && state.listIndent >= 0 && state.sCount[startLine] - state.listIndent >= 4 && state.sCount[startLine] < state.blkIndent) {
        return false;
      }
      if (silent && state.parentType === "paragraph") {
        if (state.sCount[startLine] >= state.blkIndent) {
          isTerminatingParagraph = true;
        }
      }
      if ((posAfterMarker = skipOrderedListMarker(state, startLine)) >= 0) {
        isOrdered = true;
        start = state.bMarks[startLine] + state.tShift[startLine];
        markerValue = Number(state.src.slice(start, posAfterMarker - 1));
        if (isTerminatingParagraph && markerValue !== 1)
          return false;
      } else if ((posAfterMarker = skipBulletListMarker(state, startLine)) >= 0) {
        isOrdered = false;
      } else {
        return false;
      }
      if (isTerminatingParagraph) {
        if (state.skipSpaces(posAfterMarker) >= state.eMarks[startLine])
          return false;
      }
      markerCharCode = state.src.charCodeAt(posAfterMarker - 1);
      if (silent) {
        return true;
      }
      listTokIdx = state.tokens.length;
      if (isOrdered) {
        token = state.push("ordered_list_open", "ol", 1);
        if (markerValue !== 1) {
          token.attrs = [["start", markerValue]];
        }
      } else {
        token = state.push("bullet_list_open", "ul", 1);
      }
      token.map = listLines = [startLine, 0];
      token.markup = String.fromCharCode(markerCharCode);
      nextLine = startLine;
      prevEmptyEnd = false;
      terminatorRules = state.md.block.ruler.getRules("list");
      oldParentType = state.parentType;
      state.parentType = "list";
      while (nextLine < endLine) {
        pos = posAfterMarker;
        max2 = state.eMarks[nextLine];
        initial = offset = state.sCount[nextLine] + posAfterMarker - (state.bMarks[startLine] + state.tShift[startLine]);
        while (pos < max2) {
          ch = state.src.charCodeAt(pos);
          if (ch === 9) {
            offset += 4 - (offset + state.bsCount[nextLine]) % 4;
          } else if (ch === 32) {
            offset++;
          } else {
            break;
          }
          pos++;
        }
        contentStart = pos;
        if (contentStart >= max2) {
          indentAfterMarker = 1;
        } else {
          indentAfterMarker = offset - initial;
        }
        if (!state.md.options.allowIndentation && indentAfterMarker > 4) {
          indentAfterMarker = 1;
        }
        indent = initial + indentAfterMarker;
        token = state.push("list_item_open", "li", 1);
        token.markup = String.fromCharCode(markerCharCode);
        token.map = itemLines = [startLine, 0];
        if (isOrdered) {
          token.info = state.src.slice(start, posAfterMarker - 1);
        }
        oldTight = state.tight;
        oldTShift = state.tShift[startLine];
        oldSCount = state.sCount[startLine];
        oldListIndent = state.listIndent;
        state.listIndent = state.blkIndent;
        state.blkIndent = indent;
        state.tight = true;
        state.tShift[startLine] = contentStart - state.bMarks[startLine];
        state.sCount[startLine] = offset;
        if (contentStart >= max2 && state.isEmpty(startLine + 1)) {
          state.line = Math.min(state.line + 2, endLine);
        } else {
          state.md.block.tokenize(state, startLine, endLine, true);
        }
        if (!state.tight || prevEmptyEnd) {
          tight = false;
        }
        prevEmptyEnd = state.line - startLine > 1 && state.isEmpty(state.line - 1);
        state.blkIndent = state.listIndent;
        state.listIndent = oldListIndent;
        state.tShift[startLine] = oldTShift;
        state.sCount[startLine] = oldSCount;
        state.tight = oldTight;
        token = state.push("list_item_close", "li", -1);
        token.markup = String.fromCharCode(markerCharCode);
        nextLine = startLine = state.line;
        itemLines[1] = nextLine;
        contentStart = state.bMarks[startLine];
        if (nextLine >= endLine) {
          break;
        }
        if (state.sCount[nextLine] < state.blkIndent) {
          break;
        }
        if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
          break;
        }
        terminate = false;
        for (i = 0, l = terminatorRules.length; i < l; i++) {
          if (terminatorRules[i](state, nextLine, endLine, true)) {
            terminate = true;
            break;
          }
        }
        if (terminate) {
          break;
        }
        if (isOrdered) {
          posAfterMarker = skipOrderedListMarker(state, nextLine);
          if (posAfterMarker < 0) {
            break;
          }
          start = state.bMarks[nextLine] + state.tShift[nextLine];
        } else {
          posAfterMarker = skipBulletListMarker(state, nextLine);
          if (posAfterMarker < 0) {
            break;
          }
        }
        if (markerCharCode !== state.src.charCodeAt(posAfterMarker - 1)) {
          break;
        }
      }
      if (isOrdered) {
        token = state.push("ordered_list_close", "ol", -1);
      } else {
        token = state.push("bullet_list_close", "ul", -1);
      }
      token.markup = String.fromCharCode(markerCharCode);
      listLines[1] = nextLine;
      state.line = nextLine;
      state.parentType = oldParentType;
      if (tight) {
        markTightParagraphs(state, listTokIdx);
      }
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/reference.js
var require_reference = __commonJS({
  "node_modules/markdown-it/lib/rules_block/reference.js"(exports, module) {
    var normalizeReference = require_utils().normalizeReference;
    var isSpace = require_utils().isSpace;
    module.exports = function reference(state, startLine, _endLine, silent) {
      var ch, destEndPos, destEndLineNo, endLine, href, i, l, label, labelEnd, oldParentType, res, start, str, terminate, terminatorRules, title, lines = 0, pos = state.bMarks[startLine] + state.tShift[startLine], max2 = state.eMarks[startLine], nextLine = startLine + 1;
      if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      if (state.src.charCodeAt(pos) !== 91) {
        return false;
      }
      while (++pos < max2) {
        if (state.src.charCodeAt(pos) === 93 && state.src.charCodeAt(pos - 1) !== 92) {
          if (pos + 1 === max2) {
            return false;
          }
          if (state.src.charCodeAt(pos + 1) !== 58) {
            return false;
          }
          break;
        }
      }
      endLine = state.lineMax;
      terminatorRules = state.md.block.ruler.getRules("reference");
      oldParentType = state.parentType;
      state.parentType = "reference";
      for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
        if (!state.md.options.allowIndentation && state.sCount[nextLine] - state.blkIndent > 3) {
          continue;
        }
        if (state.sCount[nextLine] < 0) {
          continue;
        }
        terminate = false;
        for (i = 0, l = terminatorRules.length; i < l; i++) {
          if (terminatorRules[i](state, nextLine, endLine, true)) {
            terminate = true;
            break;
          }
        }
        if (terminate) {
          break;
        }
      }
      str = state.getLines(startLine, nextLine, state.blkIndent, false).trim();
      max2 = str.length;
      for (pos = 1; pos < max2; pos++) {
        ch = str.charCodeAt(pos);
        if (ch === 91) {
          return false;
        } else if (ch === 93) {
          labelEnd = pos;
          break;
        } else if (ch === 10) {
          lines++;
        } else if (ch === 92) {
          pos++;
          if (pos < max2 && str.charCodeAt(pos) === 10) {
            lines++;
          }
        }
      }
      if (labelEnd < 0 || str.charCodeAt(labelEnd + 1) !== 58) {
        return false;
      }
      for (pos = labelEnd + 2; pos < max2; pos++) {
        ch = str.charCodeAt(pos);
        if (ch === 10) {
          lines++;
        } else if (isSpace(ch)) ; else {
          break;
        }
      }
      res = state.md.helpers.parseLinkDestination(str, pos, max2);
      if (!res.ok) {
        return false;
      }
      href = state.md.normalizeLink(res.str);
      if (!state.md.validateLink(href)) {
        return false;
      }
      pos = res.pos;
      lines += res.lines;
      destEndPos = pos;
      destEndLineNo = lines;
      start = pos;
      for (; pos < max2; pos++) {
        ch = str.charCodeAt(pos);
        if (ch === 10) {
          lines++;
        } else if (isSpace(ch)) ; else {
          break;
        }
      }
      res = state.md.helpers.parseLinkTitle(str, pos, max2);
      if (pos < max2 && start !== pos && res.ok) {
        title = res.str;
        pos = res.pos;
        lines += res.lines;
      } else {
        title = "";
        pos = destEndPos;
        lines = destEndLineNo;
      }
      while (pos < max2) {
        ch = str.charCodeAt(pos);
        if (!isSpace(ch)) {
          break;
        }
        pos++;
      }
      if (pos < max2 && str.charCodeAt(pos) !== 10) {
        if (title) {
          title = "";
          pos = destEndPos;
          lines = destEndLineNo;
          while (pos < max2) {
            ch = str.charCodeAt(pos);
            if (!isSpace(ch)) {
              break;
            }
            pos++;
          }
        }
      }
      if (pos < max2 && str.charCodeAt(pos) !== 10) {
        return false;
      }
      label = normalizeReference(str.slice(1, labelEnd));
      if (!label) {
        return false;
      }
      if (silent) {
        return true;
      }
      if (typeof state.env.references === "undefined") {
        state.env.references = {};
      }
      if (typeof state.env.references[label] === "undefined") {
        state.env.references[label] = { title, href };
      }
      state.parentType = oldParentType;
      state.line = startLine + lines + 1;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/common/html_blocks.js
var require_html_blocks = __commonJS({
  "node_modules/markdown-it/lib/common/html_blocks.js"(exports, module) {
    module.exports = [
      "address",
      "article",
      "aside",
      "base",
      "basefont",
      "blockquote",
      "body",
      "caption",
      "center",
      "col",
      "colgroup",
      "dd",
      "details",
      "dialog",
      "dir",
      "div",
      "dl",
      "dt",
      "fieldset",
      "figcaption",
      "figure",
      "footer",
      "form",
      "frame",
      "frameset",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "head",
      "header",
      "hr",
      "html",
      "iframe",
      "legend",
      "li",
      "link",
      "main",
      "menu",
      "menuitem",
      "nav",
      "noframes",
      "ol",
      "optgroup",
      "option",
      "p",
      "param",
      "section",
      "source",
      "summary",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "title",
      "tr",
      "track",
      "ul"
    ];
  }
});

// node_modules/markdown-it/lib/common/html_re.js
var require_html_re = __commonJS({
  "node_modules/markdown-it/lib/common/html_re.js"(exports, module) {
    var attr_name = "[a-zA-Z_:][a-zA-Z0-9:._-]*";
    var unquoted = "[^\"'=<>`\\x00-\\x20]+";
    var single_quoted = "'[^']*'";
    var double_quoted = '"[^"]*"';
    var attr_value = "(?:" + unquoted + "|" + single_quoted + "|" + double_quoted + ")";
    var attribute = "(?:\\s+" + attr_name + "(?:\\s*=\\s*" + attr_value + ")?)";
    var open_tag = "<[A-Za-z][A-Za-z0-9\\-]*" + attribute + "*\\s*\\/?>";
    var close_tag = "<\\/[A-Za-z][A-Za-z0-9\\-]*\\s*>";
    var comment2 = "<!---->|<!--(?:-?[^>-])(?:-?[^-])*-->";
    var processing = "<[?][\\s\\S]*?[?]>";
    var declaration = "<![A-Z]+\\s+[^>]*>";
    var cdata = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";
    var HTML_TAG_RE = new RegExp("^(?:" + open_tag + "|" + close_tag + "|" + comment2 + "|" + processing + "|" + declaration + "|" + cdata + ")");
    var HTML_OPEN_CLOSE_TAG_RE = new RegExp("^(?:" + open_tag + "|" + close_tag + ")");
    module.exports.HTML_TAG_RE = HTML_TAG_RE;
    module.exports.HTML_OPEN_CLOSE_TAG_RE = HTML_OPEN_CLOSE_TAG_RE;
  }
});

// node_modules/markdown-it/lib/rules_block/html_block.js
var require_html_block = __commonJS({
  "node_modules/markdown-it/lib/rules_block/html_block.js"(exports, module) {
    var block_names = require_html_blocks();
    var HTML_OPEN_CLOSE_TAG_RE = require_html_re().HTML_OPEN_CLOSE_TAG_RE;
    var HTML_SEQUENCES = [
      [/^<(script|pre|style|textarea)(?=(\s|>|$))/i, /<\/(script|pre|style|textarea)>/i, true],
      [/^<!--/, /-->/, true],
      [/^<\?/, /\?>/, true],
      [/^<![A-Z]/, />/, true],
      [/^<!\[CDATA\[/, /\]\]>/, true],
      [new RegExp("^</?(" + block_names.join("|") + ")(?=(\\s|/?>|$))", "i"), /^$/, true],
      [new RegExp(HTML_OPEN_CLOSE_TAG_RE.source + "\\s*$"), /^$/, false]
    ];
    module.exports = function html_block(state, startLine, endLine, silent) {
      var i, nextLine, token, lineText, pos = state.bMarks[startLine] + state.tShift[startLine], max2 = state.eMarks[startLine];
      if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      if (!state.md.options.html) {
        return false;
      }
      if (state.src.charCodeAt(pos) !== 60) {
        return false;
      }
      lineText = state.src.slice(pos, max2);
      for (i = 0; i < HTML_SEQUENCES.length; i++) {
        if (HTML_SEQUENCES[i][0].test(lineText)) {
          break;
        }
      }
      if (i === HTML_SEQUENCES.length) {
        return false;
      }
      if (silent) {
        return HTML_SEQUENCES[i][2];
      }
      nextLine = startLine + 1;
      if (!HTML_SEQUENCES[i][1].test(lineText)) {
        for (; nextLine < endLine; nextLine++) {
          if (state.sCount[nextLine] < state.blkIndent) {
            break;
          }
          pos = state.bMarks[nextLine] + state.tShift[nextLine];
          max2 = state.eMarks[nextLine];
          lineText = state.src.slice(pos, max2);
          if (HTML_SEQUENCES[i][1].test(lineText)) {
            if (lineText.length !== 0) {
              nextLine++;
            }
            break;
          }
        }
      }
      state.line = nextLine;
      token = state.push("html_block", "", 0);
      token.map = [startLine, nextLine];
      token.content = state.getLines(startLine, nextLine, state.blkIndent, true);
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/heading.js
var require_heading = __commonJS({
  "node_modules/markdown-it/lib/rules_block/heading.js"(exports, module) {
    var isSpace = require_utils().isSpace;
    module.exports = function heading2(state, startLine, endLine, silent) {
      var ch, level, tmp, token, pos = state.bMarks[startLine] + state.tShift[startLine], max2 = state.eMarks[startLine];
      if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      ch = state.src.charCodeAt(pos);
      if (ch !== 35 || pos >= max2) {
        return false;
      }
      level = 1;
      ch = state.src.charCodeAt(++pos);
      while (ch === 35 && pos < max2 && level <= 6) {
        level++;
        ch = state.src.charCodeAt(++pos);
      }
      if (level > 6 || pos < max2 && !isSpace(ch)) {
        return false;
      }
      if (silent) {
        return true;
      }
      max2 = state.skipSpacesBack(max2, pos);
      tmp = state.skipCharsBack(max2, 35, pos);
      if (tmp > pos && isSpace(state.src.charCodeAt(tmp - 1))) {
        max2 = tmp;
      }
      state.line = startLine + 1;
      token = state.push("heading_open", "h" + String(level), 1);
      token.markup = "########".slice(0, level);
      token.map = [startLine, state.line];
      token = state.push("inline", "", 0);
      token.content = state.src.slice(pos, max2).trim();
      token.map = [startLine, state.line];
      token.children = [];
      token = state.push("heading_close", "h" + String(level), -1);
      token.markup = "########".slice(0, level);
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/lheading.js
var require_lheading = __commonJS({
  "node_modules/markdown-it/lib/rules_block/lheading.js"(exports, module) {
    module.exports = function lheading(state, startLine, endLine) {
      var content, terminate, i, l, token, pos, max2, level, marker, nextLine = startLine + 1, oldParentType, terminatorRules = state.md.block.ruler.getRules("paragraph");
      if (!state.md.options.allowIndentation && state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }
      oldParentType = state.parentType;
      state.parentType = "paragraph";
      for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
        if (!state.md.options.allowIndentation && state.sCount[nextLine] - state.blkIndent > 3) {
          continue;
        }
        if (state.sCount[nextLine] >= state.blkIndent) {
          pos = state.bMarks[nextLine] + state.tShift[nextLine];
          max2 = state.eMarks[nextLine];
          if (pos < max2) {
            marker = state.src.charCodeAt(pos);
            if (marker === 45 || marker === 61) {
              pos = state.skipChars(pos, marker);
              pos = state.skipSpaces(pos);
              if (pos >= max2) {
                level = marker === 61 ? 1 : 2;
                break;
              }
            }
          }
        }
        if (state.sCount[nextLine] < 0) {
          continue;
        }
        terminate = false;
        for (i = 0, l = terminatorRules.length; i < l; i++) {
          if (terminatorRules[i](state, nextLine, endLine, true)) {
            terminate = true;
            break;
          }
        }
        if (terminate) {
          break;
        }
      }
      if (!level) {
        return false;
      }
      content = state.getLines(startLine, nextLine, state.blkIndent, false).trim();
      state.line = nextLine + 1;
      token = state.push("heading_open", "h" + String(level), 1);
      token.markup = String.fromCharCode(marker);
      token.map = [startLine, state.line];
      token = state.push("inline", "", 0);
      token.content = content;
      token.map = [startLine, state.line - 1];
      token.children = [];
      token = state.push("heading_close", "h" + String(level), -1);
      token.markup = String.fromCharCode(marker);
      state.parentType = oldParentType;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/paragraph.js
var require_paragraph = __commonJS({
  "node_modules/markdown-it/lib/rules_block/paragraph.js"(exports, module) {
    module.exports = function paragraph2(state, startLine) {
      var content, terminate, i, l, token, oldParentType, nextLine = startLine + 1, terminatorRules = state.md.block.ruler.getRules("paragraph"), endLine = state.lineMax;
      oldParentType = state.parentType;
      state.parentType = "paragraph";
      for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
        if (!state.md.options.allowIndentation && state.sCount[nextLine] - state.blkIndent > 3) {
          continue;
        }
        if (state.sCount[nextLine] < 0) {
          continue;
        }
        terminate = false;
        for (i = 0, l = terminatorRules.length; i < l; i++) {
          if (terminatorRules[i](state, nextLine, endLine, true)) {
            terminate = true;
            break;
          }
        }
        if (terminate) {
          break;
        }
      }
      content = state.getLines(startLine, nextLine, state.blkIndent, false).trim();
      state.line = nextLine;
      token = state.push("paragraph_open", "p", 1);
      token.map = [startLine, state.line];
      token = state.push("inline", "", 0);
      token.content = content;
      token.map = [startLine, state.line];
      token.children = [];
      token = state.push("paragraph_close", "p", -1);
      state.parentType = oldParentType;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_block/state_block.js
var require_state_block = __commonJS({
  "node_modules/markdown-it/lib/rules_block/state_block.js"(exports, module) {
    var Token = require_token();
    var isSpace = require_utils().isSpace;
    function StateBlock(src, md, env, tokens) {
      var ch, s2, start, pos, len, indent, offset, indent_found;
      this.src = src;
      this.md = md;
      this.env = env;
      this.tokens = tokens;
      this.bMarks = [];
      this.eMarks = [];
      this.tShift = [];
      this.sCount = [];
      this.bsCount = [];
      this.blkIndent = 0;
      this.line = 0;
      this.lineMax = 0;
      this.tight = false;
      this.ddIndent = -1;
      this.listIndent = -1;
      this.parentType = "root";
      this.level = 0;
      this.result = "";
      s2 = this.src;
      indent_found = false;
      for (start = pos = indent = offset = 0, len = s2.length; pos < len; pos++) {
        ch = s2.charCodeAt(pos);
        if (!indent_found) {
          if (isSpace(ch)) {
            indent++;
            if (ch === 9) {
              offset += 4 - offset % 4;
            } else {
              offset++;
            }
            continue;
          } else {
            indent_found = true;
          }
        }
        if (ch === 10 || pos === len - 1) {
          if (ch !== 10) {
            pos++;
          }
          this.bMarks.push(start);
          this.eMarks.push(pos);
          this.tShift.push(indent);
          this.sCount.push(offset);
          this.bsCount.push(0);
          indent_found = false;
          indent = 0;
          offset = 0;
          start = pos + 1;
        }
      }
      this.bMarks.push(s2.length);
      this.eMarks.push(s2.length);
      this.tShift.push(0);
      this.sCount.push(0);
      this.bsCount.push(0);
      this.lineMax = this.bMarks.length - 1;
    }
    StateBlock.prototype.push = function(type, tag, nesting) {
      var token = new Token(type, tag, nesting);
      token.block = true;
      if (nesting < 0)
        this.level--;
      token.level = this.level;
      if (nesting > 0)
        this.level++;
      this.tokens.push(token);
      return token;
    };
    StateBlock.prototype.isEmpty = function isEmpty(line) {
      return this.bMarks[line] + this.tShift[line] >= this.eMarks[line];
    };
    StateBlock.prototype.skipEmptyLines = function skipEmptyLines(from) {
      for (var max2 = this.lineMax; from < max2; from++) {
        if (this.bMarks[from] + this.tShift[from] < this.eMarks[from]) {
          break;
        }
      }
      return from;
    };
    StateBlock.prototype.skipSpaces = function skipSpaces(pos) {
      var ch;
      for (var max2 = this.src.length; pos < max2; pos++) {
        ch = this.src.charCodeAt(pos);
        if (!isSpace(ch)) {
          break;
        }
      }
      return pos;
    };
    StateBlock.prototype.skipSpacesBack = function skipSpacesBack(pos, min) {
      if (pos <= min) {
        return pos;
      }
      while (pos > min) {
        if (!isSpace(this.src.charCodeAt(--pos))) {
          return pos + 1;
        }
      }
      return pos;
    };
    StateBlock.prototype.skipChars = function skipChars(pos, code2) {
      for (var max2 = this.src.length; pos < max2; pos++) {
        if (this.src.charCodeAt(pos) !== code2) {
          break;
        }
      }
      return pos;
    };
    StateBlock.prototype.skipCharsBack = function skipCharsBack(pos, code2, min) {
      if (pos <= min) {
        return pos;
      }
      while (pos > min) {
        if (code2 !== this.src.charCodeAt(--pos)) {
          return pos + 1;
        }
      }
      return pos;
    };
    StateBlock.prototype.getLines = function getLines(begin, end, indent, keepLastLF) {
      var i, lineIndent, ch, first, last, queue, lineStart, line = begin;
      if (begin >= end) {
        return "";
      }
      queue = new Array(end - begin);
      for (i = 0; line < end; line++, i++) {
        lineIndent = 0;
        lineStart = first = this.bMarks[line];
        if (line + 1 < end || keepLastLF) {
          last = this.eMarks[line] + 1;
        } else {
          last = this.eMarks[line];
        }
        while (first < last && lineIndent < indent) {
          ch = this.src.charCodeAt(first);
          if (isSpace(ch)) {
            if (ch === 9) {
              lineIndent += 4 - (lineIndent + this.bsCount[line]) % 4;
            } else {
              lineIndent++;
            }
          } else if (first - lineStart < this.tShift[line]) {
            lineIndent++;
          } else {
            break;
          }
          first++;
        }
        if (lineIndent > indent) {
          queue[i] = new Array(lineIndent - indent + 1).join(" ") + this.src.slice(first, last);
        } else {
          queue[i] = this.src.slice(first, last);
        }
      }
      return queue.join("");
    };
    StateBlock.prototype.Token = Token;
    module.exports = StateBlock;
  }
});

// node_modules/markdown-it/lib/parser_block.js
var require_parser_block = __commonJS({
  "node_modules/markdown-it/lib/parser_block.js"(exports, module) {
    var Ruler = require_ruler();
    var _rules = [
      ["table", require_table(), ["paragraph", "reference"]],
      ["code", require_code()],
      ["fence", require_fence(), ["paragraph", "reference", "blockquote", "list"]],
      ["blockquote", require_blockquote(), ["paragraph", "reference", "blockquote", "list"]],
      ["hr", require_hr(), ["paragraph", "reference", "blockquote", "list"]],
      ["list", require_list(), ["paragraph", "reference", "blockquote"]],
      ["reference", require_reference()],
      ["html_block", require_html_block(), ["paragraph", "reference", "blockquote"]],
      ["heading", require_heading(), ["paragraph", "reference", "blockquote"]],
      ["lheading", require_lheading()],
      ["paragraph", require_paragraph()]
    ];
    function ParserBlock() {
      this.ruler = new Ruler();
      for (var i = 0; i < _rules.length; i++) {
        this.ruler.push(_rules[i][0], _rules[i][1], { alt: (_rules[i][2] || []).slice() });
      }
    }
    ParserBlock.prototype.tokenize = function(state, startLine, endLine) {
      var ok, i, rules = this.ruler.getRules(""), len = rules.length, line = startLine, hasEmptyLines = false, maxNesting = state.md.options.maxNesting;
      while (line < endLine) {
        state.line = line = state.skipEmptyLines(line);
        if (line >= endLine) {
          break;
        }
        if (state.sCount[line] < state.blkIndent) {
          break;
        }
        if (state.level >= maxNesting) {
          state.line = endLine;
          break;
        }
        for (i = 0; i < len; i++) {
          ok = rules[i](state, line, endLine, false);
          if (ok) {
            break;
          }
        }
        state.tight = !hasEmptyLines;
        if (state.isEmpty(state.line - 1)) {
          hasEmptyLines = true;
        }
        line = state.line;
        if (line < endLine && state.isEmpty(line)) {
          hasEmptyLines = true;
          line++;
          state.line = line;
        }
      }
    };
    ParserBlock.prototype.parse = function(src, md, env, outTokens) {
      var state;
      if (!src) {
        return;
      }
      state = new this.State(src, md, env, outTokens);
      this.tokenize(state, state.line, state.lineMax);
    };
    ParserBlock.prototype.State = require_state_block();
    module.exports = ParserBlock;
  }
});

// node_modules/markdown-it/lib/rules_inline/text.js
var require_text = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/text.js"(exports, module) {
    function isTerminatorChar(ch) {
      switch (ch) {
        case 10:
        case 33:
        case 35:
        case 36:
        case 37:
        case 38:
        case 42:
        case 43:
        case 45:
        case 58:
        case 60:
        case 61:
        case 62:
        case 64:
        case 91:
        case 92:
        case 93:
        case 94:
        case 95:
        case 96:
        case 123:
        case 125:
        case 126:
          return true;
        default:
          return false;
      }
    }
    module.exports = function text2(state, silent) {
      var pos = state.pos;
      while (pos < state.posMax && !isTerminatorChar(state.src.charCodeAt(pos))) {
        pos++;
      }
      if (pos === state.pos) {
        return false;
      }
      if (!silent) {
        state.pending += state.src.slice(state.pos, pos);
      }
      state.pos = pos;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/newline.js
var require_newline = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/newline.js"(exports, module) {
    var isSpace = require_utils().isSpace;
    module.exports = function newline(state, silent) {
      var pmax, max2, ws, pos = state.pos;
      if (state.src.charCodeAt(pos) !== 10) {
        return false;
      }
      pmax = state.pending.length - 1;
      max2 = state.posMax;
      if (!silent) {
        if (pmax >= 0 && state.pending.charCodeAt(pmax) === 32) {
          if (pmax >= 1 && state.pending.charCodeAt(pmax - 1) === 32) {
            ws = pmax - 1;
            while (ws >= 1 && state.pending.charCodeAt(ws - 1) === 32)
              ws--;
            state.pending = state.pending.slice(0, ws);
            state.push("hardbreak", "br", 0);
          } else {
            state.pending = state.pending.slice(0, -1);
            state.push("softbreak", "br", 0);
          }
        } else {
          state.push("softbreak", "br", 0);
        }
      }
      pos++;
      while (pos < max2 && isSpace(state.src.charCodeAt(pos))) {
        pos++;
      }
      state.pos = pos;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/escape.js
var require_escape = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/escape.js"(exports, module) {
    var isSpace = require_utils().isSpace;
    var ESCAPED = [];
    for (i = 0; i < 256; i++) {
      ESCAPED.push(0);
    }
    var i;
    "\\!\"#$%&'()*+,./:;<=>?@[]^_`{|}~-".split("").forEach(function(ch) {
      ESCAPED[ch.charCodeAt(0)] = 1;
    });
    module.exports = function escape(state, silent) {
      var ch, pos = state.pos, max2 = state.posMax;
      if (state.src.charCodeAt(pos) !== 92) {
        return false;
      }
      pos++;
      if (pos < max2) {
        ch = state.src.charCodeAt(pos);
        if (ch < 256 && ESCAPED[ch] !== 0) {
          if (!silent) {
            state.pending += state.src[pos];
          }
          state.pos += 2;
          return true;
        }
        if (ch === 10) {
          if (!silent) {
            state.push("hardbreak", "br", 0);
          }
          pos++;
          while (pos < max2) {
            ch = state.src.charCodeAt(pos);
            if (!isSpace(ch)) {
              break;
            }
            pos++;
          }
          state.pos = pos;
          return true;
        }
      }
      if (!silent) {
        state.pending += "\\";
      }
      state.pos++;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/backticks.js
var require_backticks = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/backticks.js"(exports, module) {
    module.exports = function backtick(state, silent) {
      var start, max2, marker, token, matchStart, matchEnd, openerLength, closerLength, pos = state.pos, ch = state.src.charCodeAt(pos);
      if (ch !== 96) {
        return false;
      }
      start = pos;
      pos++;
      max2 = state.posMax;
      while (pos < max2 && state.src.charCodeAt(pos) === 96) {
        pos++;
      }
      marker = state.src.slice(start, pos);
      openerLength = marker.length;
      if (state.backticksScanned && (state.backticks[openerLength] || 0) <= start) {
        if (!silent)
          state.pending += marker;
        state.pos += openerLength;
        return true;
      }
      matchStart = matchEnd = pos;
      while ((matchStart = state.src.indexOf("`", matchEnd)) !== -1) {
        matchEnd = matchStart + 1;
        while (matchEnd < max2 && state.src.charCodeAt(matchEnd) === 96) {
          matchEnd++;
        }
        closerLength = matchEnd - matchStart;
        if (closerLength === openerLength) {
          if (!silent) {
            token = state.push("code_inline", "code", 0);
            token.markup = marker;
            token.content = state.src.slice(pos, matchStart).replace(/\n/g, " ").replace(/^ (.+) $/, "$1");
          }
          state.pos = matchEnd;
          return true;
        }
        state.backticks[closerLength] = matchStart;
      }
      state.backticksScanned = true;
      if (!silent)
        state.pending += marker;
      state.pos += openerLength;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/strikethrough.js
var require_strikethrough = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/strikethrough.js"(exports, module) {
    module.exports.tokenize = function strikethrough(state, silent) {
      var i, scanned, token, len, ch, start = state.pos, marker = state.src.charCodeAt(start);
      if (silent) {
        return false;
      }
      if (marker !== 126) {
        return false;
      }
      scanned = state.scanDelims(state.pos, true);
      len = scanned.length;
      ch = String.fromCharCode(marker);
      if (len < 2) {
        return false;
      }
      if (len % 2) {
        token = state.push("text", "", 0);
        token.content = ch;
        len--;
      }
      for (i = 0; i < len; i += 2) {
        token = state.push("text", "", 0);
        token.content = ch + ch;
        state.delimiters.push({
          marker,
          length: 0,
          token: state.tokens.length - 1,
          end: -1,
          open: scanned.can_open,
          close: scanned.can_close
        });
      }
      state.pos += scanned.length;
      return true;
    };
    function postProcess(state, delimiters) {
      var i, j, startDelim, endDelim, token, loneMarkers = [], max2 = delimiters.length;
      for (i = 0; i < max2; i++) {
        startDelim = delimiters[i];
        if (startDelim.marker !== 126) {
          continue;
        }
        if (startDelim.end === -1) {
          continue;
        }
        endDelim = delimiters[startDelim.end];
        token = state.tokens[startDelim.token];
        token.type = "s_open";
        token.tag = "s";
        token.nesting = 1;
        token.markup = "~~";
        token.content = "";
        token = state.tokens[endDelim.token];
        token.type = "s_close";
        token.tag = "s";
        token.nesting = -1;
        token.markup = "~~";
        token.content = "";
        if (state.tokens[endDelim.token - 1].type === "text" && state.tokens[endDelim.token - 1].content === "~") {
          loneMarkers.push(endDelim.token - 1);
        }
      }
      while (loneMarkers.length) {
        i = loneMarkers.pop();
        j = i + 1;
        while (j < state.tokens.length && state.tokens[j].type === "s_close") {
          j++;
        }
        j--;
        if (i !== j) {
          token = state.tokens[j];
          state.tokens[j] = state.tokens[i];
          state.tokens[i] = token;
        }
      }
    }
    module.exports.postProcess = function strikethrough(state) {
      var curr, tokens_meta = state.tokens_meta, max2 = state.tokens_meta.length;
      postProcess(state, state.delimiters);
      for (curr = 0; curr < max2; curr++) {
        if (tokens_meta[curr] && tokens_meta[curr].delimiters) {
          postProcess(state, tokens_meta[curr].delimiters);
        }
      }
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/emphasis.js
var require_emphasis = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/emphasis.js"(exports, module) {
    module.exports.tokenize = function emphasis(state, silent) {
      var i, scanned, token, start = state.pos, marker = state.src.charCodeAt(start);
      if (silent) {
        return false;
      }
      if (marker !== 95 && marker !== 42) {
        return false;
      }
      scanned = state.scanDelims(state.pos, marker === 42);
      for (i = 0; i < scanned.length; i++) {
        token = state.push("text", "", 0);
        token.content = String.fromCharCode(marker);
        state.delimiters.push({
          marker,
          length: scanned.length,
          token: state.tokens.length - 1,
          end: -1,
          open: scanned.can_open,
          close: scanned.can_close
        });
      }
      state.pos += scanned.length;
      return true;
    };
    function postProcess(state, delimiters) {
      var i, startDelim, endDelim, token, ch, isStrong, max2 = delimiters.length;
      for (i = max2 - 1; i >= 0; i--) {
        startDelim = delimiters[i];
        if (startDelim.marker !== 95 && startDelim.marker !== 42) {
          continue;
        }
        if (startDelim.end === -1) {
          continue;
        }
        endDelim = delimiters[startDelim.end];
        isStrong = i > 0 && delimiters[i - 1].end === startDelim.end + 1 && delimiters[i - 1].marker === startDelim.marker && delimiters[i - 1].token === startDelim.token - 1 && delimiters[startDelim.end + 1].token === endDelim.token + 1;
        ch = String.fromCharCode(startDelim.marker);
        token = state.tokens[startDelim.token];
        token.type = isStrong ? "strong_open" : "em_open";
        token.tag = isStrong ? "strong" : "em";
        token.nesting = 1;
        token.markup = isStrong ? ch + ch : ch;
        token.content = "";
        token = state.tokens[endDelim.token];
        token.type = isStrong ? "strong_close" : "em_close";
        token.tag = isStrong ? "strong" : "em";
        token.nesting = -1;
        token.markup = isStrong ? ch + ch : ch;
        token.content = "";
        if (isStrong) {
          state.tokens[delimiters[i - 1].token].content = "";
          state.tokens[delimiters[startDelim.end + 1].token].content = "";
          i--;
        }
      }
    }
    module.exports.postProcess = function emphasis(state) {
      var curr, tokens_meta = state.tokens_meta, max2 = state.tokens_meta.length;
      postProcess(state, state.delimiters);
      for (curr = 0; curr < max2; curr++) {
        if (tokens_meta[curr] && tokens_meta[curr].delimiters) {
          postProcess(state, tokens_meta[curr].delimiters);
        }
      }
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/link.js
var require_link = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/link.js"(exports, module) {
    var normalizeReference = require_utils().normalizeReference;
    var isSpace = require_utils().isSpace;
    module.exports = function link2(state, silent) {
      var attrs, code2, label, labelEnd, labelStart, pos, res, ref, token, href = "", title = "", oldPos = state.pos, max2 = state.posMax, start = state.pos, parseReference = true;
      if (state.src.charCodeAt(state.pos) !== 91) {
        return false;
      }
      labelStart = state.pos + 1;
      labelEnd = state.md.helpers.parseLinkLabel(state, state.pos, true);
      if (labelEnd < 0) {
        return false;
      }
      pos = labelEnd + 1;
      if (pos < max2 && state.src.charCodeAt(pos) === 40) {
        parseReference = false;
        pos++;
        for (; pos < max2; pos++) {
          code2 = state.src.charCodeAt(pos);
          if (!isSpace(code2) && code2 !== 10) {
            break;
          }
        }
        if (pos >= max2) {
          return false;
        }
        start = pos;
        res = state.md.helpers.parseLinkDestination(state.src, pos, state.posMax);
        if (res.ok) {
          href = state.md.normalizeLink(res.str);
          if (state.md.validateLink(href)) {
            pos = res.pos;
          } else {
            href = "";
          }
          start = pos;
          for (; pos < max2; pos++) {
            code2 = state.src.charCodeAt(pos);
            if (!isSpace(code2) && code2 !== 10) {
              break;
            }
          }
          res = state.md.helpers.parseLinkTitle(state.src, pos, state.posMax);
          if (pos < max2 && start !== pos && res.ok) {
            title = res.str;
            pos = res.pos;
            for (; pos < max2; pos++) {
              code2 = state.src.charCodeAt(pos);
              if (!isSpace(code2) && code2 !== 10) {
                break;
              }
            }
          }
        }
        if (pos >= max2 || state.src.charCodeAt(pos) !== 41) {
          parseReference = true;
        }
        pos++;
      }
      if (parseReference) {
        if (typeof state.env.references === "undefined") {
          return false;
        }
        if (pos < max2 && state.src.charCodeAt(pos) === 91) {
          start = pos + 1;
          pos = state.md.helpers.parseLinkLabel(state, pos);
          if (pos >= 0) {
            label = state.src.slice(start, pos++);
          } else {
            pos = labelEnd + 1;
          }
        } else {
          pos = labelEnd + 1;
        }
        if (!label) {
          label = state.src.slice(labelStart, labelEnd);
        }
        ref = state.env.references[normalizeReference(label)];
        if (!ref) {
          state.pos = oldPos;
          return false;
        }
        href = ref.href;
        title = ref.title;
      }
      if (!silent) {
        state.pos = labelStart;
        state.posMax = labelEnd;
        token = state.push("link_open", "a", 1);
        token.attrs = attrs = [["href", href]];
        if (title) {
          attrs.push(["title", title]);
        }
        state.md.inline.tokenize(state);
        token = state.push("link_close", "a", -1);
      }
      state.pos = pos;
      state.posMax = max2;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/image.js
var require_image = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/image.js"(exports, module) {
    var normalizeReference = require_utils().normalizeReference;
    var isSpace = require_utils().isSpace;
    module.exports = function image2(state, silent) {
      var attrs, code2, content, label, labelEnd, labelStart, pos, ref, res, title, token, tokens, start, href = "", oldPos = state.pos, max2 = state.posMax;
      if (state.src.charCodeAt(state.pos) !== 33) {
        return false;
      }
      if (state.src.charCodeAt(state.pos + 1) !== 91) {
        return false;
      }
      labelStart = state.pos + 2;
      labelEnd = state.md.helpers.parseLinkLabel(state, state.pos + 1, false);
      if (labelEnd < 0) {
        return false;
      }
      pos = labelEnd + 1;
      if (pos < max2 && state.src.charCodeAt(pos) === 40) {
        pos++;
        for (; pos < max2; pos++) {
          code2 = state.src.charCodeAt(pos);
          if (!isSpace(code2) && code2 !== 10) {
            break;
          }
        }
        if (pos >= max2) {
          return false;
        }
        start = pos;
        res = state.md.helpers.parseLinkDestination(state.src, pos, state.posMax);
        if (res.ok) {
          href = state.md.normalizeLink(res.str);
          if (state.md.validateLink(href)) {
            pos = res.pos;
          } else {
            href = "";
          }
        }
        start = pos;
        for (; pos < max2; pos++) {
          code2 = state.src.charCodeAt(pos);
          if (!isSpace(code2) && code2 !== 10) {
            break;
          }
        }
        res = state.md.helpers.parseLinkTitle(state.src, pos, state.posMax);
        if (pos < max2 && start !== pos && res.ok) {
          title = res.str;
          pos = res.pos;
          for (; pos < max2; pos++) {
            code2 = state.src.charCodeAt(pos);
            if (!isSpace(code2) && code2 !== 10) {
              break;
            }
          }
        } else {
          title = "";
        }
        if (pos >= max2 || state.src.charCodeAt(pos) !== 41) {
          state.pos = oldPos;
          return false;
        }
        pos++;
      } else {
        if (typeof state.env.references === "undefined") {
          return false;
        }
        if (pos < max2 && state.src.charCodeAt(pos) === 91) {
          start = pos + 1;
          pos = state.md.helpers.parseLinkLabel(state, pos);
          if (pos >= 0) {
            label = state.src.slice(start, pos++);
          } else {
            pos = labelEnd + 1;
          }
        } else {
          pos = labelEnd + 1;
        }
        if (!label) {
          label = state.src.slice(labelStart, labelEnd);
        }
        ref = state.env.references[normalizeReference(label)];
        if (!ref) {
          state.pos = oldPos;
          return false;
        }
        href = ref.href;
        title = ref.title;
      }
      if (!silent) {
        content = state.src.slice(labelStart, labelEnd);
        state.md.inline.parse(content, state.md, state.env, tokens = []);
        token = state.push("image", "img", 0);
        token.attrs = attrs = [["src", href], ["alt", ""]];
        token.children = tokens;
        token.content = content;
        if (title) {
          attrs.push(["title", title]);
        }
      }
      state.pos = pos;
      state.posMax = max2;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/autolink.js
var require_autolink = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/autolink.js"(exports, module) {
    var EMAIL_RE = /^([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;
    var AUTOLINK_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]{1,31}):([^<>\x00-\x20]*)$/;
    module.exports = function autolink(state, silent) {
      var url, fullUrl, token, ch, start, max2, pos = state.pos;
      if (state.src.charCodeAt(pos) !== 60) {
        return false;
      }
      start = state.pos;
      max2 = state.posMax;
      for (; ; ) {
        if (++pos >= max2)
          return false;
        ch = state.src.charCodeAt(pos);
        if (ch === 60)
          return false;
        if (ch === 62)
          break;
      }
      url = state.src.slice(start + 1, pos);
      if (AUTOLINK_RE.test(url)) {
        fullUrl = state.md.normalizeLink(url);
        if (!state.md.validateLink(fullUrl)) {
          return false;
        }
        if (!silent) {
          token = state.push("link_open", "a", 1);
          token.attrs = [["href", fullUrl]];
          token.markup = "autolink";
          token.info = "auto";
          token = state.push("text", "", 0);
          token.content = state.md.normalizeLinkText(url);
          token = state.push("link_close", "a", -1);
          token.markup = "autolink";
          token.info = "auto";
        }
        state.pos += url.length + 2;
        return true;
      }
      if (EMAIL_RE.test(url)) {
        fullUrl = state.md.normalizeLink("mailto:" + url);
        if (!state.md.validateLink(fullUrl)) {
          return false;
        }
        if (!silent) {
          token = state.push("link_open", "a", 1);
          token.attrs = [["href", fullUrl]];
          token.markup = "autolink";
          token.info = "auto";
          token = state.push("text", "", 0);
          token.content = state.md.normalizeLinkText(url);
          token = state.push("link_close", "a", -1);
          token.markup = "autolink";
          token.info = "auto";
        }
        state.pos += url.length + 2;
        return true;
      }
      return false;
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/html_inline.js
var require_html_inline = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/html_inline.js"(exports, module) {
    var HTML_TAG_RE = require_html_re().HTML_TAG_RE;
    function isLetter(ch) {
      var lc = ch | 32;
      return lc >= 97 && lc <= 122;
    }
    module.exports = function html_inline(state, silent) {
      var ch, match, max2, token, pos = state.pos;
      if (!state.md.options.html) {
        return false;
      }
      max2 = state.posMax;
      if (state.src.charCodeAt(pos) !== 60 || pos + 2 >= max2) {
        return false;
      }
      ch = state.src.charCodeAt(pos + 1);
      if (ch !== 33 && ch !== 63 && ch !== 47 && !isLetter(ch)) {
        return false;
      }
      match = state.src.slice(pos).match(HTML_TAG_RE);
      if (!match) {
        return false;
      }
      if (!silent) {
        token = state.push("html_inline", "", 0);
        token.content = state.src.slice(pos, pos + match[0].length);
      }
      state.pos += match[0].length;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/entity.js
var require_entity = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/entity.js"(exports, module) {
    var entities = require_entities2();
    var has = require_utils().has;
    var isValidEntityCode = require_utils().isValidEntityCode;
    var fromCodePoint = require_utils().fromCodePoint;
    var DIGITAL_RE = /^&#((?:x[a-f0-9]{1,6}|[0-9]{1,7}));/i;
    var NAMED_RE = /^&([a-z][a-z0-9]{1,31});/i;
    module.exports = function entity(state, silent) {
      var ch, code2, match, pos = state.pos, max2 = state.posMax;
      if (state.src.charCodeAt(pos) !== 38) {
        return false;
      }
      if (pos + 1 < max2) {
        ch = state.src.charCodeAt(pos + 1);
        if (ch === 35) {
          match = state.src.slice(pos).match(DIGITAL_RE);
          if (match) {
            if (!silent) {
              code2 = match[1][0].toLowerCase() === "x" ? parseInt(match[1].slice(1), 16) : parseInt(match[1], 10);
              state.pending += isValidEntityCode(code2) ? fromCodePoint(code2) : fromCodePoint(65533);
            }
            state.pos += match[0].length;
            return true;
          }
        } else {
          match = state.src.slice(pos).match(NAMED_RE);
          if (match) {
            if (has(entities, match[1])) {
              if (!silent) {
                state.pending += entities[match[1]];
              }
              state.pos += match[0].length;
              return true;
            }
          }
        }
      }
      if (!silent) {
        state.pending += "&";
      }
      state.pos++;
      return true;
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/balance_pairs.js
var require_balance_pairs = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/balance_pairs.js"(exports, module) {
    function processDelimiters(state, delimiters) {
      var closerIdx, openerIdx, closer, opener, minOpenerIdx, newMinOpenerIdx, isOddMatch, lastJump, openersBottom = {}, max2 = delimiters.length;
      if (!max2)
        return;
      var headerIdx = 0;
      var lastTokenIdx = -2;
      var jumps = [];
      for (closerIdx = 0; closerIdx < max2; closerIdx++) {
        closer = delimiters[closerIdx];
        jumps.push(0);
        if (delimiters[headerIdx].marker !== closer.marker || lastTokenIdx !== closer.token - 1) {
          headerIdx = closerIdx;
        }
        lastTokenIdx = closer.token;
        closer.length = closer.length || 0;
        if (!closer.close)
          continue;
        if (!openersBottom.hasOwnProperty(closer.marker)) {
          openersBottom[closer.marker] = [-1, -1, -1, -1, -1, -1];
        }
        minOpenerIdx = openersBottom[closer.marker][(closer.open ? 3 : 0) + closer.length % 3];
        openerIdx = headerIdx - jumps[headerIdx] - 1;
        newMinOpenerIdx = openerIdx;
        for (; openerIdx > minOpenerIdx; openerIdx -= jumps[openerIdx] + 1) {
          opener = delimiters[openerIdx];
          if (opener.marker !== closer.marker)
            continue;
          if (opener.open && opener.end < 0) {
            isOddMatch = false;
            if (opener.close || closer.open) {
              if ((opener.length + closer.length) % 3 === 0) {
                if (opener.length % 3 !== 0 || closer.length % 3 !== 0) {
                  isOddMatch = true;
                }
              }
            }
            if (!isOddMatch) {
              lastJump = openerIdx > 0 && !delimiters[openerIdx - 1].open ? jumps[openerIdx - 1] + 1 : 0;
              jumps[closerIdx] = closerIdx - openerIdx + lastJump;
              jumps[openerIdx] = lastJump;
              closer.open = false;
              opener.end = closerIdx;
              opener.close = false;
              newMinOpenerIdx = -1;
              lastTokenIdx = -2;
              break;
            }
          }
        }
        if (newMinOpenerIdx !== -1) {
          openersBottom[closer.marker][(closer.open ? 3 : 0) + (closer.length || 0) % 3] = newMinOpenerIdx;
        }
      }
    }
    module.exports = function link_pairs(state) {
      var curr, tokens_meta = state.tokens_meta, max2 = state.tokens_meta.length;
      processDelimiters(state, state.delimiters);
      for (curr = 0; curr < max2; curr++) {
        if (tokens_meta[curr] && tokens_meta[curr].delimiters) {
          processDelimiters(state, tokens_meta[curr].delimiters);
        }
      }
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/text_collapse.js
var require_text_collapse = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/text_collapse.js"(exports, module) {
    module.exports = function text_collapse(state) {
      var curr, last, level = 0, tokens = state.tokens, max2 = state.tokens.length;
      for (curr = last = 0; curr < max2; curr++) {
        if (tokens[curr].nesting < 0)
          level--;
        tokens[curr].level = level;
        if (tokens[curr].nesting > 0)
          level++;
        if (tokens[curr].type === "text" && curr + 1 < max2 && tokens[curr + 1].type === "text") {
          tokens[curr + 1].content = tokens[curr].content + tokens[curr + 1].content;
        } else {
          if (curr !== last) {
            tokens[last] = tokens[curr];
          }
          last++;
        }
      }
      if (curr !== last) {
        tokens.length = last;
      }
    };
  }
});

// node_modules/markdown-it/lib/rules_inline/state_inline.js
var require_state_inline = __commonJS({
  "node_modules/markdown-it/lib/rules_inline/state_inline.js"(exports, module) {
    var Token = require_token();
    var isWhiteSpace = require_utils().isWhiteSpace;
    var isPunctChar = require_utils().isPunctChar;
    var isMdAsciiPunct = require_utils().isMdAsciiPunct;
    function StateInline(src, md, env, outTokens) {
      this.src = src;
      this.env = env;
      this.md = md;
      this.tokens = outTokens;
      this.tokens_meta = Array(outTokens.length);
      this.pos = 0;
      this.posMax = this.src.length;
      this.level = 0;
      this.pending = "";
      this.pendingLevel = 0;
      this.cache = {};
      this.delimiters = [];
      this._prev_delimiters = [];
      this.backticks = {};
      this.backticksScanned = false;
    }
    StateInline.prototype.pushPending = function() {
      var token = new Token("text", "", 0);
      token.content = this.pending;
      token.level = this.pendingLevel;
      this.tokens.push(token);
      this.pending = "";
      return token;
    };
    StateInline.prototype.push = function(type, tag, nesting) {
      if (this.pending) {
        this.pushPending();
      }
      var token = new Token(type, tag, nesting);
      var token_meta = null;
      if (nesting < 0) {
        this.level--;
        this.delimiters = this._prev_delimiters.pop();
      }
      token.level = this.level;
      if (nesting > 0) {
        this.level++;
        this._prev_delimiters.push(this.delimiters);
        this.delimiters = [];
        token_meta = { delimiters: this.delimiters };
      }
      this.pendingLevel = this.level;
      this.tokens.push(token);
      this.tokens_meta.push(token_meta);
      return token;
    };
    StateInline.prototype.scanDelims = function(start, canSplitWord) {
      var pos = start, lastChar, nextChar, count, can_open, can_close, isLastWhiteSpace, isLastPunctChar, isNextWhiteSpace, isNextPunctChar, left_flanking = true, right_flanking = true, max2 = this.posMax, marker = this.src.charCodeAt(start);
      lastChar = start > 0 ? this.src.charCodeAt(start - 1) : 32;
      while (pos < max2 && this.src.charCodeAt(pos) === marker) {
        pos++;
      }
      count = pos - start;
      nextChar = pos < max2 ? this.src.charCodeAt(pos) : 32;
      isLastPunctChar = isMdAsciiPunct(lastChar) || isPunctChar(String.fromCharCode(lastChar));
      isNextPunctChar = isMdAsciiPunct(nextChar) || isPunctChar(String.fromCharCode(nextChar));
      isLastWhiteSpace = isWhiteSpace(lastChar);
      isNextWhiteSpace = isWhiteSpace(nextChar);
      if (isNextWhiteSpace) {
        left_flanking = false;
      } else if (isNextPunctChar) {
        if (!(isLastWhiteSpace || isLastPunctChar)) {
          left_flanking = false;
        }
      }
      if (isLastWhiteSpace) {
        right_flanking = false;
      } else if (isLastPunctChar) {
        if (!(isNextWhiteSpace || isNextPunctChar)) {
          right_flanking = false;
        }
      }
      if (!canSplitWord) {
        can_open = left_flanking && (!right_flanking || isLastPunctChar);
        can_close = right_flanking && (!left_flanking || isNextPunctChar);
      } else {
        can_open = left_flanking;
        can_close = right_flanking;
      }
      return {
        can_open,
        can_close,
        length: count
      };
    };
    StateInline.prototype.Token = Token;
    module.exports = StateInline;
  }
});

// node_modules/markdown-it/lib/parser_inline.js
var require_parser_inline = __commonJS({
  "node_modules/markdown-it/lib/parser_inline.js"(exports, module) {
    var Ruler = require_ruler();
    var _rules = [
      ["text", require_text()],
      ["newline", require_newline()],
      ["escape", require_escape()],
      ["backticks", require_backticks()],
      ["strikethrough", require_strikethrough().tokenize],
      ["emphasis", require_emphasis().tokenize],
      ["link", require_link()],
      ["image", require_image()],
      ["autolink", require_autolink()],
      ["html_inline", require_html_inline()],
      ["entity", require_entity()]
    ];
    var _rules2 = [
      ["balance_pairs", require_balance_pairs()],
      ["strikethrough", require_strikethrough().postProcess],
      ["emphasis", require_emphasis().postProcess],
      ["text_collapse", require_text_collapse()]
    ];
    function ParserInline() {
      var i;
      this.ruler = new Ruler();
      for (i = 0; i < _rules.length; i++) {
        this.ruler.push(_rules[i][0], _rules[i][1]);
      }
      this.ruler2 = new Ruler();
      for (i = 0; i < _rules2.length; i++) {
        this.ruler2.push(_rules2[i][0], _rules2[i][1]);
      }
    }
    ParserInline.prototype.skipToken = function(state) {
      var ok, i, pos = state.pos, rules = this.ruler.getRules(""), len = rules.length, maxNesting = state.md.options.maxNesting, cache = state.cache;
      if (typeof cache[pos] !== "undefined") {
        state.pos = cache[pos];
        return;
      }
      if (state.level < maxNesting) {
        for (i = 0; i < len; i++) {
          state.level++;
          ok = rules[i](state, true);
          state.level--;
          if (ok) {
            break;
          }
        }
      } else {
        state.pos = state.posMax;
      }
      if (!ok) {
        state.pos++;
      }
      cache[pos] = state.pos;
    };
    ParserInline.prototype.tokenize = function(state) {
      var ok, i, rules = this.ruler.getRules(""), len = rules.length, end = state.posMax, maxNesting = state.md.options.maxNesting;
      while (state.pos < end) {
        if (state.level < maxNesting) {
          for (i = 0; i < len; i++) {
            ok = rules[i](state, false);
            if (ok) {
              break;
            }
          }
        }
        if (ok) {
          if (state.pos >= end) {
            break;
          }
          continue;
        }
        state.pending += state.src[state.pos++];
      }
      if (state.pending) {
        state.pushPending();
      }
    };
    ParserInline.prototype.parse = function(str, md, env, outTokens) {
      var i, rules, len;
      var state = new this.State(str, md, env, outTokens);
      this.tokenize(state);
      rules = this.ruler2.getRules("");
      len = rules.length;
      for (i = 0; i < len; i++) {
        rules[i](state);
      }
    };
    ParserInline.prototype.State = require_state_inline();
    module.exports = ParserInline;
  }
});

// node_modules/linkify-it/lib/re.js
var require_re = __commonJS({
  "node_modules/linkify-it/lib/re.js"(exports, module) {
    module.exports = function(opts) {
      var re = {};
      re.src_Any = require_regex2().source;
      re.src_Cc = require_regex3().source;
      re.src_Z = require_regex5().source;
      re.src_P = require_regex().source;
      re.src_ZPCc = [re.src_Z, re.src_P, re.src_Cc].join("|");
      re.src_ZCc = [re.src_Z, re.src_Cc].join("|");
      var text_separators = "[><\uFF5C]";
      re.src_pseudo_letter = "(?:(?!" + text_separators + "|" + re.src_ZPCc + ")" + re.src_Any + ")";
      re.src_ip4 = "(?:(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)";
      re.src_auth = "(?:(?:(?!" + re.src_ZCc + "|[@/\\[\\]()]).)+@)?";
      re.src_port = "(?::(?:6(?:[0-4]\\d{3}|5(?:[0-4]\\d{2}|5(?:[0-2]\\d|3[0-5])))|[1-5]?\\d{1,4}))?";
      re.src_host_terminator = "(?=$|" + text_separators + "|" + re.src_ZPCc + ")(?!-|_|:\\d|\\.-|\\.(?!$|" + re.src_ZPCc + "))";
      re.src_path = "(?:[/?#](?:(?!" + re.src_ZCc + "|" + text_separators + `|[()[\\]{}.,"'?!\\-;]).|\\[(?:(?!` + re.src_ZCc + "|\\]).)*\\]|\\((?:(?!" + re.src_ZCc + "|[)]).)*\\)|\\{(?:(?!" + re.src_ZCc + '|[}]).)*\\}|\\"(?:(?!' + re.src_ZCc + `|["]).)+\\"|\\'(?:(?!` + re.src_ZCc + "|[']).)+\\'|\\'(?=" + re.src_pseudo_letter + "|[-]).|\\.{2,}[a-zA-Z0-9%/&]|\\.(?!" + re.src_ZCc + "|[.]).|" + (opts && opts["---"] ? "\\-(?!--(?:[^-]|$))(?:-*)|" : "\\-+|") + ",(?!" + re.src_ZCc + ").|;(?!" + re.src_ZCc + ").|\\!+(?!" + re.src_ZCc + "|[!]).|\\?(?!" + re.src_ZCc + "|[?]).)+|\\/)?";
      re.src_email_name = '[\\-;:&=\\+\\$,\\.a-zA-Z0-9_][\\-;:&=\\+\\$,\\"\\.a-zA-Z0-9_]*';
      re.src_xn = "xn--[a-z0-9\\-]{1,59}";
      re.src_domain_root = "(?:" + re.src_xn + "|" + re.src_pseudo_letter + "{1,63})";
      re.src_domain = "(?:" + re.src_xn + "|(?:" + re.src_pseudo_letter + ")|(?:" + re.src_pseudo_letter + "(?:-|" + re.src_pseudo_letter + "){0,61}" + re.src_pseudo_letter + "))";
      re.src_host = "(?:(?:(?:(?:" + re.src_domain + ")\\.)*" + re.src_domain + "))";
      re.tpl_host_fuzzy = "(?:" + re.src_ip4 + "|(?:(?:(?:" + re.src_domain + ")\\.)+(?:%TLDS%)))";
      re.tpl_host_no_ip_fuzzy = "(?:(?:(?:" + re.src_domain + ")\\.)+(?:%TLDS%))";
      re.src_host_strict = re.src_host + re.src_host_terminator;
      re.tpl_host_fuzzy_strict = re.tpl_host_fuzzy + re.src_host_terminator;
      re.src_host_port_strict = re.src_host + re.src_port + re.src_host_terminator;
      re.tpl_host_port_fuzzy_strict = re.tpl_host_fuzzy + re.src_port + re.src_host_terminator;
      re.tpl_host_port_no_ip_fuzzy_strict = re.tpl_host_no_ip_fuzzy + re.src_port + re.src_host_terminator;
      re.tpl_host_fuzzy_test = "localhost|www\\.|\\.\\d{1,3}\\.|(?:\\.(?:%TLDS%)(?:" + re.src_ZPCc + "|>|$))";
      re.tpl_email_fuzzy = "(^|" + text_separators + '|"|\\(|' + re.src_ZCc + ")(" + re.src_email_name + "@" + re.tpl_host_fuzzy_strict + ")";
      re.tpl_link_fuzzy = "(^|(?![.:/\\-_@])(?:[$+<=>^`|\uFF5C]|" + re.src_ZPCc + "))((?![$+<=>^`|\uFF5C])" + re.tpl_host_port_fuzzy_strict + re.src_path + ")";
      re.tpl_link_no_ip_fuzzy = "(^|(?![.:/\\-_@])(?:[$+<=>^`|\uFF5C]|" + re.src_ZPCc + "))((?![$+<=>^`|\uFF5C])" + re.tpl_host_port_no_ip_fuzzy_strict + re.src_path + ")";
      return re;
    };
  }
});

// node_modules/linkify-it/index.js
var require_linkify_it = __commonJS({
  "node_modules/linkify-it/index.js"(exports, module) {
    function assign(obj) {
      var sources = Array.prototype.slice.call(arguments, 1);
      sources.forEach(function(source) {
        if (!source) {
          return;
        }
        Object.keys(source).forEach(function(key) {
          obj[key] = source[key];
        });
      });
      return obj;
    }
    function _class(obj) {
      return Object.prototype.toString.call(obj);
    }
    function isString(obj) {
      return _class(obj) === "[object String]";
    }
    function isObject(obj) {
      return _class(obj) === "[object Object]";
    }
    function isRegExp(obj) {
      return _class(obj) === "[object RegExp]";
    }
    function isFunction2(obj) {
      return _class(obj) === "[object Function]";
    }
    function escapeRE(str) {
      return str.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
    }
    var defaultOptions = {
      fuzzyLink: true,
      fuzzyEmail: true,
      fuzzyIP: false
    };
    function isOptionsObj(obj) {
      return Object.keys(obj || {}).reduce(function(acc, k) {
        return acc || defaultOptions.hasOwnProperty(k);
      }, false);
    }
    var defaultSchemas = {
      "http:": {
        validate: function(text2, pos, self) {
          var tail = text2.slice(pos);
          if (!self.re.http) {
            self.re.http = new RegExp("^\\/\\/" + self.re.src_auth + self.re.src_host_port_strict + self.re.src_path, "i");
          }
          if (self.re.http.test(tail)) {
            return tail.match(self.re.http)[0].length;
          }
          return 0;
        }
      },
      "https:": "http:",
      "ftp:": "http:",
      "//": {
        validate: function(text2, pos, self) {
          var tail = text2.slice(pos);
          if (!self.re.no_http) {
            self.re.no_http = new RegExp("^" + self.re.src_auth + "(?:localhost|(?:(?:" + self.re.src_domain + ")\\.)+" + self.re.src_domain_root + ")" + self.re.src_port + self.re.src_host_terminator + self.re.src_path, "i");
          }
          if (self.re.no_http.test(tail)) {
            if (pos >= 3 && text2[pos - 3] === ":") {
              return 0;
            }
            if (pos >= 3 && text2[pos - 3] === "/") {
              return 0;
            }
            return tail.match(self.re.no_http)[0].length;
          }
          return 0;
        }
      },
      "mailto:": {
        validate: function(text2, pos, self) {
          var tail = text2.slice(pos);
          if (!self.re.mailto) {
            self.re.mailto = new RegExp("^" + self.re.src_email_name + "@" + self.re.src_host_strict, "i");
          }
          if (self.re.mailto.test(tail)) {
            return tail.match(self.re.mailto)[0].length;
          }
          return 0;
        }
      }
    };
    var tlds_2ch_src_re = "a[cdefgilmnoqrstuwxz]|b[abdefghijmnorstvwyz]|c[acdfghiklmnoruvwxyz]|d[ejkmoz]|e[cegrstu]|f[ijkmor]|g[abdefghilmnpqrstuwy]|h[kmnrtu]|i[delmnoqrst]|j[emop]|k[eghimnprwyz]|l[abcikrstuvy]|m[acdeghklmnopqrstuvwxyz]|n[acefgilopruz]|om|p[aefghklmnrstwy]|qa|r[eosuw]|s[abcdeghijklmnortuvxyz]|t[cdfghjklmnortvwz]|u[agksyz]|v[aceginu]|w[fs]|y[et]|z[amw]";
    var tlds_default = "biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|\u0440\u0444".split("|");
    function resetScanCache(self) {
      self.__index__ = -1;
      self.__text_cache__ = "";
    }
    function createValidator(re) {
      return function(text2, pos) {
        var tail = text2.slice(pos);
        if (re.test(tail)) {
          return tail.match(re)[0].length;
        }
        return 0;
      };
    }
    function createNormalizer() {
      return function(match, self) {
        self.normalize(match);
      };
    }
    function compile(self) {
      var re = self.re = require_re()(self.__opts__);
      var tlds = self.__tlds__.slice();
      self.onCompile();
      if (!self.__tlds_replaced__) {
        tlds.push(tlds_2ch_src_re);
      }
      tlds.push(re.src_xn);
      re.src_tlds = tlds.join("|");
      function untpl(tpl) {
        return tpl.replace("%TLDS%", re.src_tlds);
      }
      re.email_fuzzy = RegExp(untpl(re.tpl_email_fuzzy), "i");
      re.link_fuzzy = RegExp(untpl(re.tpl_link_fuzzy), "i");
      re.link_no_ip_fuzzy = RegExp(untpl(re.tpl_link_no_ip_fuzzy), "i");
      re.host_fuzzy_test = RegExp(untpl(re.tpl_host_fuzzy_test), "i");
      var aliases = [];
      self.__compiled__ = {};
      function schemaError(name, val) {
        throw new Error('(LinkifyIt) Invalid schema "' + name + '": ' + val);
      }
      Object.keys(self.__schemas__).forEach(function(name) {
        var val = self.__schemas__[name];
        if (val === null) {
          return;
        }
        var compiled = { validate: null, link: null };
        self.__compiled__[name] = compiled;
        if (isObject(val)) {
          if (isRegExp(val.validate)) {
            compiled.validate = createValidator(val.validate);
          } else if (isFunction2(val.validate)) {
            compiled.validate = val.validate;
          } else {
            schemaError(name, val);
          }
          if (isFunction2(val.normalize)) {
            compiled.normalize = val.normalize;
          } else if (!val.normalize) {
            compiled.normalize = createNormalizer();
          } else {
            schemaError(name, val);
          }
          return;
        }
        if (isString(val)) {
          aliases.push(name);
          return;
        }
        schemaError(name, val);
      });
      aliases.forEach(function(alias) {
        if (!self.__compiled__[self.__schemas__[alias]]) {
          return;
        }
        self.__compiled__[alias].validate = self.__compiled__[self.__schemas__[alias]].validate;
        self.__compiled__[alias].normalize = self.__compiled__[self.__schemas__[alias]].normalize;
      });
      self.__compiled__[""] = { validate: null, normalize: createNormalizer() };
      var slist = Object.keys(self.__compiled__).filter(function(name) {
        return name.length > 0 && self.__compiled__[name];
      }).map(escapeRE).join("|");
      self.re.schema_test = RegExp("(^|(?!_)(?:[><\uFF5C]|" + re.src_ZPCc + "))(" + slist + ")", "i");
      self.re.schema_search = RegExp("(^|(?!_)(?:[><\uFF5C]|" + re.src_ZPCc + "))(" + slist + ")", "ig");
      self.re.pretest = RegExp("(" + self.re.schema_test.source + ")|(" + self.re.host_fuzzy_test.source + ")|@", "i");
      resetScanCache(self);
    }
    function Match(self, shift) {
      var start = self.__index__, end = self.__last_index__, text2 = self.__text_cache__.slice(start, end);
      this.schema = self.__schema__.toLowerCase();
      this.index = start + shift;
      this.lastIndex = end + shift;
      this.raw = text2;
      this.text = text2;
      this.url = text2;
    }
    function createMatch(self, shift) {
      var match = new Match(self, shift);
      self.__compiled__[match.schema].normalize(match, self);
      return match;
    }
    function LinkifyIt(schemas, options) {
      if (!(this instanceof LinkifyIt)) {
        return new LinkifyIt(schemas, options);
      }
      if (!options) {
        if (isOptionsObj(schemas)) {
          options = schemas;
          schemas = {};
        }
      }
      this.__opts__ = assign({}, defaultOptions, options);
      this.__index__ = -1;
      this.__last_index__ = -1;
      this.__schema__ = "";
      this.__text_cache__ = "";
      this.__schemas__ = assign({}, defaultSchemas, schemas);
      this.__compiled__ = {};
      this.__tlds__ = tlds_default;
      this.__tlds_replaced__ = false;
      this.re = {};
      compile(this);
    }
    LinkifyIt.prototype.add = function add(schema, definition) {
      this.__schemas__[schema] = definition;
      compile(this);
      return this;
    };
    LinkifyIt.prototype.set = function set(options) {
      this.__opts__ = assign(this.__opts__, options);
      return this;
    };
    LinkifyIt.prototype.test = function test(text2) {
      this.__text_cache__ = text2;
      this.__index__ = -1;
      if (!text2.length) {
        return false;
      }
      var m, ml, me, len, shift, next, re, tld_pos, at_pos;
      if (this.re.schema_test.test(text2)) {
        re = this.re.schema_search;
        re.lastIndex = 0;
        while ((m = re.exec(text2)) !== null) {
          len = this.testSchemaAt(text2, m[2], re.lastIndex);
          if (len) {
            this.__schema__ = m[2];
            this.__index__ = m.index + m[1].length;
            this.__last_index__ = m.index + m[0].length + len;
            break;
          }
        }
      }
      if (this.__opts__.fuzzyLink && this.__compiled__["http:"]) {
        tld_pos = text2.search(this.re.host_fuzzy_test);
        if (tld_pos >= 0) {
          if (this.__index__ < 0 || tld_pos < this.__index__) {
            if ((ml = text2.match(this.__opts__.fuzzyIP ? this.re.link_fuzzy : this.re.link_no_ip_fuzzy)) !== null) {
              shift = ml.index + ml[1].length;
              if (this.__index__ < 0 || shift < this.__index__) {
                this.__schema__ = "";
                this.__index__ = shift;
                this.__last_index__ = ml.index + ml[0].length;
              }
            }
          }
        }
      }
      if (this.__opts__.fuzzyEmail && this.__compiled__["mailto:"]) {
        at_pos = text2.indexOf("@");
        if (at_pos >= 0) {
          if ((me = text2.match(this.re.email_fuzzy)) !== null) {
            shift = me.index + me[1].length;
            next = me.index + me[0].length;
            if (this.__index__ < 0 || shift < this.__index__ || shift === this.__index__ && next > this.__last_index__) {
              this.__schema__ = "mailto:";
              this.__index__ = shift;
              this.__last_index__ = next;
            }
          }
        }
      }
      return this.__index__ >= 0;
    };
    LinkifyIt.prototype.pretest = function pretest(text2) {
      return this.re.pretest.test(text2);
    };
    LinkifyIt.prototype.testSchemaAt = function testSchemaAt(text2, schema, pos) {
      if (!this.__compiled__[schema.toLowerCase()]) {
        return 0;
      }
      return this.__compiled__[schema.toLowerCase()].validate(text2, pos, this);
    };
    LinkifyIt.prototype.match = function match(text2) {
      var shift = 0, result = [];
      if (this.__index__ >= 0 && this.__text_cache__ === text2) {
        result.push(createMatch(this, shift));
        shift = this.__last_index__;
      }
      var tail = shift ? text2.slice(shift) : text2;
      while (this.test(tail)) {
        result.push(createMatch(this, shift));
        tail = tail.slice(this.__last_index__);
        shift += this.__last_index__;
      }
      if (result.length) {
        return result;
      }
      return null;
    };
    LinkifyIt.prototype.tlds = function tlds(list2, keepOld) {
      list2 = Array.isArray(list2) ? list2 : [list2];
      if (!keepOld) {
        this.__tlds__ = list2.slice();
        this.__tlds_replaced__ = true;
        compile(this);
        return this;
      }
      this.__tlds__ = this.__tlds__.concat(list2).sort().filter(function(el, idx, arr) {
        return el !== arr[idx - 1];
      }).reverse();
      compile(this);
      return this;
    };
    LinkifyIt.prototype.normalize = function normalize(match) {
      if (!match.schema) {
        match.url = "http://" + match.url;
      }
      if (match.schema === "mailto:" && !/^mailto:/i.test(match.url)) {
        match.url = "mailto:" + match.url;
      }
    };
    LinkifyIt.prototype.onCompile = function onCompile() {
    };
    module.exports = LinkifyIt;
  }
});

// node_modules/punycode/punycode.js
var require_punycode = __commonJS({
  "node_modules/punycode/punycode.js"(exports, module) {
    var maxInt = 2147483647;
    var base = 36;
    var tMin = 1;
    var tMax = 26;
    var skew = 38;
    var damp = 700;
    var initialBias = 72;
    var initialN = 128;
    var delimiter = "-";
    var regexPunycode = /^xn--/;
    var regexNonASCII = /[^\0-\x7E]/;
    var regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g;
    var errors = {
      "overflow": "Overflow: input needs wider integers to process",
      "not-basic": "Illegal input >= 0x80 (not a basic code point)",
      "invalid-input": "Invalid input"
    };
    var baseMinusTMin = base - tMin;
    var floor = Math.floor;
    var stringFromCharCode = String.fromCharCode;
    function error2(type) {
      throw new RangeError(errors[type]);
    }
    function map(array, fn) {
      const result = [];
      let length = array.length;
      while (length--) {
        result[length] = fn(array[length]);
      }
      return result;
    }
    function mapDomain(string, fn) {
      const parts = string.split("@");
      let result = "";
      if (parts.length > 1) {
        result = parts[0] + "@";
        string = parts[1];
      }
      string = string.replace(regexSeparators, ".");
      const labels = string.split(".");
      const encoded = map(labels, fn).join(".");
      return result + encoded;
    }
    function ucs2decode(string) {
      const output = [];
      let counter = 0;
      const length = string.length;
      while (counter < length) {
        const value = string.charCodeAt(counter++);
        if (value >= 55296 && value <= 56319 && counter < length) {
          const extra = string.charCodeAt(counter++);
          if ((extra & 64512) == 56320) {
            output.push(((value & 1023) << 10) + (extra & 1023) + 65536);
          } else {
            output.push(value);
            counter--;
          }
        } else {
          output.push(value);
        }
      }
      return output;
    }
    var ucs2encode = (array) => String.fromCodePoint(...array);
    var basicToDigit = function(codePoint) {
      if (codePoint - 48 < 10) {
        return codePoint - 22;
      }
      if (codePoint - 65 < 26) {
        return codePoint - 65;
      }
      if (codePoint - 97 < 26) {
        return codePoint - 97;
      }
      return base;
    };
    var digitToBasic = function(digit, flag) {
      return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
    };
    var adapt = function(delta, numPoints, firstTime) {
      let k = 0;
      delta = firstTime ? floor(delta / damp) : delta >> 1;
      delta += floor(delta / numPoints);
      for (; delta > baseMinusTMin * tMax >> 1; k += base) {
        delta = floor(delta / baseMinusTMin);
      }
      return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
    };
    var decode = function(input) {
      const output = [];
      const inputLength = input.length;
      let i = 0;
      let n = initialN;
      let bias = initialBias;
      let basic = input.lastIndexOf(delimiter);
      if (basic < 0) {
        basic = 0;
      }
      for (let j = 0; j < basic; ++j) {
        if (input.charCodeAt(j) >= 128) {
          error2("not-basic");
        }
        output.push(input.charCodeAt(j));
      }
      for (let index = basic > 0 ? basic + 1 : 0; index < inputLength; ) {
        let oldi = i;
        for (let w = 1, k = base; ; k += base) {
          if (index >= inputLength) {
            error2("invalid-input");
          }
          const digit = basicToDigit(input.charCodeAt(index++));
          if (digit >= base || digit > floor((maxInt - i) / w)) {
            error2("overflow");
          }
          i += digit * w;
          const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
          if (digit < t) {
            break;
          }
          const baseMinusT = base - t;
          if (w > floor(maxInt / baseMinusT)) {
            error2("overflow");
          }
          w *= baseMinusT;
        }
        const out = output.length + 1;
        bias = adapt(i - oldi, out, oldi == 0);
        if (floor(i / out) > maxInt - n) {
          error2("overflow");
        }
        n += floor(i / out);
        i %= out;
        output.splice(i++, 0, n);
      }
      return String.fromCodePoint(...output);
    };
    var encode = function(input) {
      const output = [];
      input = ucs2decode(input);
      let inputLength = input.length;
      let n = initialN;
      let delta = 0;
      let bias = initialBias;
      for (const currentValue of input) {
        if (currentValue < 128) {
          output.push(stringFromCharCode(currentValue));
        }
      }
      let basicLength = output.length;
      let handledCPCount = basicLength;
      if (basicLength) {
        output.push(delimiter);
      }
      while (handledCPCount < inputLength) {
        let m = maxInt;
        for (const currentValue of input) {
          if (currentValue >= n && currentValue < m) {
            m = currentValue;
          }
        }
        const handledCPCountPlusOne = handledCPCount + 1;
        if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
          error2("overflow");
        }
        delta += (m - n) * handledCPCountPlusOne;
        n = m;
        for (const currentValue of input) {
          if (currentValue < n && ++delta > maxInt) {
            error2("overflow");
          }
          if (currentValue == n) {
            let q = delta;
            for (let k = base; ; k += base) {
              const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
              if (q < t) {
                break;
              }
              const qMinusT = q - t;
              const baseMinusT = base - t;
              output.push(stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0)));
              q = floor(qMinusT / baseMinusT);
            }
            output.push(stringFromCharCode(digitToBasic(q, 0)));
            bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
            delta = 0;
            ++handledCPCount;
          }
        }
        ++delta;
        ++n;
      }
      return output.join("");
    };
    var toUnicode = function(input) {
      return mapDomain(input, function(string) {
        return regexPunycode.test(string) ? decode(string.slice(4).toLowerCase()) : string;
      });
    };
    var toASCII = function(input) {
      return mapDomain(input, function(string) {
        return regexNonASCII.test(string) ? "xn--" + encode(string) : string;
      });
    };
    var punycode = {
      "version": "2.1.0",
      "ucs2": {
        "decode": ucs2decode,
        "encode": ucs2encode
      },
      "decode": decode,
      "encode": encode,
      "toASCII": toASCII,
      "toUnicode": toUnicode
    };
    module.exports = punycode;
  }
});

// node_modules/markdown-it/lib/presets/default.js
var require_default = __commonJS({
  "node_modules/markdown-it/lib/presets/default.js"(exports, module) {
    module.exports = {
      options: {
        html: false,
        xhtmlOut: false,
        breaks: false,
        langPrefix: "language-",
        linkify: false,
        typographer: false,
        quotes: "\u201C\u201D\u2018\u2019",
        highlight: null,
        maxNesting: 100
      },
      components: {
        core: {},
        block: {},
        inline: {}
      }
    };
  }
});

// node_modules/markdown-it/lib/presets/zero.js
var require_zero = __commonJS({
  "node_modules/markdown-it/lib/presets/zero.js"(exports, module) {
    module.exports = {
      options: {
        html: false,
        xhtmlOut: false,
        breaks: false,
        langPrefix: "language-",
        linkify: false,
        typographer: false,
        quotes: "\u201C\u201D\u2018\u2019",
        highlight: null,
        maxNesting: 20
      },
      components: {
        core: {
          rules: [
            "normalize",
            "block",
            "inline"
          ]
        },
        block: {
          rules: [
            "paragraph"
          ]
        },
        inline: {
          rules: [
            "text"
          ],
          rules2: [
            "balance_pairs",
            "text_collapse"
          ]
        }
      }
    };
  }
});

// node_modules/markdown-it/lib/presets/commonmark.js
var require_commonmark = __commonJS({
  "node_modules/markdown-it/lib/presets/commonmark.js"(exports, module) {
    module.exports = {
      options: {
        html: true,
        xhtmlOut: true,
        breaks: false,
        langPrefix: "language-",
        linkify: false,
        typographer: false,
        quotes: "\u201C\u201D\u2018\u2019",
        highlight: null,
        maxNesting: 20
      },
      components: {
        core: {
          rules: [
            "normalize",
            "block",
            "inline"
          ]
        },
        block: {
          rules: [
            "blockquote",
            "code",
            "fence",
            "heading",
            "hr",
            "html_block",
            "lheading",
            "list",
            "reference",
            "paragraph"
          ]
        },
        inline: {
          rules: [
            "autolink",
            "backticks",
            "emphasis",
            "entity",
            "escape",
            "html_inline",
            "image",
            "link",
            "newline",
            "text"
          ],
          rules2: [
            "balance_pairs",
            "emphasis",
            "text_collapse"
          ]
        }
      }
    };
  }
});

// node_modules/markdown-it/lib/index.js
var require_lib = __commonJS({
  "node_modules/markdown-it/lib/index.js"(exports, module) {
    var utils = require_utils();
    var helpers = require_helpers();
    var Renderer = require_renderer();
    var ParserCore = require_parser_core();
    var ParserBlock = require_parser_block();
    var ParserInline = require_parser_inline();
    var LinkifyIt = require_linkify_it();
    var mdurl = require_mdurl();
    var punycode = require_punycode();
    var config = {
      default: require_default(),
      zero: require_zero(),
      commonmark: require_commonmark()
    };
    var BAD_PROTO_RE = /^(vbscript|javascript|file|data):/;
    var GOOD_DATA_RE = /^data:image\/(gif|png|jpeg|webp);/;
    function validateLink(url) {
      var str = url.trim().toLowerCase();
      return BAD_PROTO_RE.test(str) ? GOOD_DATA_RE.test(str) ? true : false : true;
    }
    var RECODE_HOSTNAME_FOR = ["http:", "https:", "mailto:"];
    function normalizeLink(url) {
      var parsed = mdurl.parse(url, true);
      if (parsed.hostname) {
        if (!parsed.protocol || RECODE_HOSTNAME_FOR.indexOf(parsed.protocol) >= 0) {
          try {
            parsed.hostname = punycode.toASCII(parsed.hostname);
          } catch (er) {
          }
        }
      }
      return mdurl.encode(mdurl.format(parsed));
    }
    function normalizeLinkText(url) {
      var parsed = mdurl.parse(url, true);
      if (parsed.hostname) {
        if (!parsed.protocol || RECODE_HOSTNAME_FOR.indexOf(parsed.protocol) >= 0) {
          try {
            parsed.hostname = punycode.toUnicode(parsed.hostname);
          } catch (er) {
          }
        }
      }
      return mdurl.decode(mdurl.format(parsed), mdurl.decode.defaultChars + "%");
    }
    function MarkdownIt3(presetName, options) {
      if (!(this instanceof MarkdownIt3)) {
        return new MarkdownIt3(presetName, options);
      }
      if (!options) {
        if (!utils.isString(presetName)) {
          options = presetName || {};
          presetName = "default";
        }
      }
      this.inline = new ParserInline();
      this.block = new ParserBlock();
      this.core = new ParserCore();
      this.renderer = new Renderer();
      this.linkify = new LinkifyIt();
      this.validateLink = validateLink;
      this.normalizeLink = normalizeLink;
      this.normalizeLinkText = normalizeLinkText;
      this.utils = utils;
      this.helpers = utils.assign({}, helpers);
      this.options = {};
      this.configure(presetName);
      if (options) {
        this.set(options);
      }
    }
    MarkdownIt3.prototype.set = function(options) {
      utils.assign(this.options, options);
      return this;
    };
    MarkdownIt3.prototype.configure = function(presets) {
      var self = this, presetName;
      if (utils.isString(presets)) {
        presetName = presets;
        presets = config[presetName];
        if (!presets) {
          throw new Error('Wrong `markdown-it` preset "' + presetName + '", check name');
        }
      }
      if (!presets) {
        throw new Error("Wrong `markdown-it` preset, can't be empty");
      }
      if (presets.options) {
        self.set(presets.options);
      }
      if (presets.components) {
        Object.keys(presets.components).forEach(function(name) {
          if (presets.components[name].rules) {
            self[name].ruler.enableOnly(presets.components[name].rules);
          }
          if (presets.components[name].rules2) {
            self[name].ruler2.enableOnly(presets.components[name].rules2);
          }
        });
      }
      return this;
    };
    MarkdownIt3.prototype.enable = function(list2, ignoreInvalid) {
      var result = [];
      if (!Array.isArray(list2)) {
        list2 = [list2];
      }
      ["core", "block", "inline"].forEach(function(chain) {
        result = result.concat(this[chain].ruler.enable(list2, true));
      }, this);
      result = result.concat(this.inline.ruler2.enable(list2, true));
      var missed = list2.filter(function(name) {
        return result.indexOf(name) < 0;
      });
      if (missed.length && !ignoreInvalid) {
        throw new Error("MarkdownIt. Failed to enable unknown rule(s): " + missed);
      }
      return this;
    };
    MarkdownIt3.prototype.disable = function(list2, ignoreInvalid) {
      var result = [];
      if (!Array.isArray(list2)) {
        list2 = [list2];
      }
      ["core", "block", "inline"].forEach(function(chain) {
        result = result.concat(this[chain].ruler.disable(list2, true));
      }, this);
      result = result.concat(this.inline.ruler2.disable(list2, true));
      var missed = list2.filter(function(name) {
        return result.indexOf(name) < 0;
      });
      if (missed.length && !ignoreInvalid) {
        throw new Error("MarkdownIt. Failed to disable unknown rule(s): " + missed);
      }
      return this;
    };
    MarkdownIt3.prototype.use = function(plugin4) {
      var args = [this].concat(Array.prototype.slice.call(arguments, 1));
      plugin4.apply(plugin4, args);
      return this;
    };
    MarkdownIt3.prototype.parse = function(src, env) {
      if (typeof src !== "string") {
        throw new Error("Input data should be a String");
      }
      var state = new this.core.State(src, this, env);
      this.core.process(state);
      return state.tokens;
    };
    MarkdownIt3.prototype.render = function(src, env) {
      env = env || {};
      return this.renderer.render(this.parse(src, env), this.options, env);
    };
    MarkdownIt3.prototype.parseInline = function(src, env) {
      var state = new this.core.State(src, this, env);
      state.inlineMode = true;
      this.core.process(state);
      return state.tokens;
    };
    MarkdownIt3.prototype.renderInline = function(src, env) {
      env = env || {};
      return this.renderer.render(this.parseInline(src, env), this.options, env);
    };
    module.exports = MarkdownIt3;
  }
});

// node_modules/markdown-it/index.js
var require_markdown_it = __commonJS({
  "node_modules/markdown-it/index.js"(exports, module) {
    module.exports = require_lib();
  }
});

// src/ast/base.ts
var base_exports = {};
__export(base_exports, {
  getAstValues: () => getAstValues,
  isAst: () => isAst,
  isFunction: () => isFunction,
  isVariable: () => isVariable,
  resolve: () => resolve
});
function isAst(value) {
  return !!value?.$$mdtype;
}
function isFunction(value) {
  return !!(value?.$$mdtype === "Function");
}
function isVariable(value) {
  return !!(value?.$$mdtype === "Variable");
}
function* getAstValues(value) {
  if (value == null || typeof value !== "object")
    return;
  if (Array.isArray(value))
    for (const v of value)
      yield* getAstValues(v);
  if (isAst(value))
    yield value;
  if (Object.getPrototypeOf(value) !== Object.prototype)
    return;
  for (const v of Object.values(value))
    yield* getAstValues(v);
}
function resolve(value, config = {}) {
  if (value == null || typeof value !== "object")
    return value;
  if (Array.isArray(value))
    return value.map((item2) => resolve(item2, config));
  if (isAst(value) && value?.resolve instanceof Function)
    return value.resolve(config);
  if (Object.getPrototypeOf(value) !== Object.prototype)
    return value;
  const output = {};
  for (const [k, v] of Object.entries(value))
    output[k] = resolve(v, config);
  return output;
}

// src/tag.ts
var Tag = class {
  constructor(name = "div", attributes = {}, children = []) {
    this.$$mdtype = "Tag";
    this.name = name;
    this.attributes = attributes;
    this.children = children;
  }
};
Tag.isTag = (tag) => {
  return !!(tag?.$$mdtype === "Tag");
};

// src/schema-types/class.ts
var Class = class {
  validate(value, _config, key) {
    if (typeof value === "string" || typeof value === "object")
      return [];
    return [
      {
        id: "attribute-type-invalid",
        level: "error",
        message: `Attribute '${key}' must be type 'string | object'`
      }
    ];
  }
  transform(value) {
    if (!value || typeof value === "string")
      return value;
    const classes = [];
    for (const [k, v] of Object.entries(value ?? {}))
      if (v)
        classes.push(k);
    return classes.join(" ");
  }
};

// src/schema-types/id.ts
var Id = class {
  validate(value) {
    if (typeof value === "string" && value.match(/^[a-zA-Z]/))
      return [];
    return [
      {
        id: "attribute-value-invalid",
        level: "error",
        message: "The 'id' attribute must start with a letter"
      }
    ];
  }
};

// src/utils.ts
var import_tag = __toModule(require_tag());

// src/ast/variable.ts
var Variable = class {
  constructor(path = []) {
    this.$$mdtype = "Variable";
    this.path = path;
  }
  resolve({ variables } = {}) {
    return variables instanceof Function ? variables(this.path) : this.path.reduce((obj = {}, key) => obj[key], variables);
  }
};

// src/ast/function.ts
var Function2 = class {
  constructor(name, parameters) {
    this.$$mdtype = "Function";
    this.name = name;
    this.parameters = parameters;
  }
  resolve(config = {}) {
    const fn = config?.functions?.[this.name];
    if (!fn)
      return null;
    const parameters = resolve(this.parameters, config);
    return fn.transform?.(parameters, config);
  }
};

// src/utils.ts
var STATES;
(function(STATES2) {
  STATES2[STATES2["normal"] = 0] = "normal";
  STATES2[STATES2["string"] = 1] = "string";
  STATES2[STATES2["escape"] = 2] = "escape";
})(STATES || (STATES = {}));
var OPEN = "{%";
var CLOSE = "%}";
function isPromise(a) {
  return a && typeof a === "object" && typeof a.then === "function";
}
function findTagEnd(content, start = 0) {
  let state = 0;
  for (let pos = start; pos < content.length; pos++) {
    const char = content[pos];
    switch (state) {
      case 1:
        switch (char) {
          case '"':
            state = 0;
            break;
          case "\\":
            state = 2;
            break;
        }
        break;
      case 2:
        state = 1;
        break;
      case 0:
        if (char === '"')
          state = 1;
        else if (content.startsWith(CLOSE, pos))
          return pos;
    }
  }
  return null;
}
function parseTag(content, line, contentStart) {
  try {
    return (0, import_tag.parse)(content, { Variable, Function: Function2 });
  } catch (error2) {
    if (!(error2 instanceof import_tag.SyntaxError))
      throw error2;
    const {
      message,
      location: { start, end }
    } = error2;
    const location = {
      start: { line, character: start.offset + contentStart },
      end: { line: line + 1, character: end.offset + contentStart }
    };
    return { type: "error", meta: { error: { message, location } } };
  }
}
function parseTags(content, firstLine = 0) {
  let line = firstLine + 1;
  const output = [];
  let start = 0;
  for (let pos = 0; pos < content.length; pos++) {
    if (content[pos] === "\n") {
      line++;
      continue;
    }
    if (!content.startsWith(OPEN, pos))
      continue;
    const end = findTagEnd(content, pos);
    if (end == null) {
      pos = pos + OPEN.length;
      continue;
    }
    const text2 = content.slice(pos, end + CLOSE.length);
    const inner = content.slice(pos + OPEN.length, end);
    const lineStart = content.lastIndexOf("\n", pos);
    const lineEnd = content.indexOf("\n", end);
    const lineContent = content.slice(lineStart, lineEnd);
    const tag = parseTag(inner.trim(), line, pos - lineStart);
    const precedingTextEnd = lineContent.trim() === text2 ? lineStart : pos;
    const precedingText = content.slice(start, precedingTextEnd);
    output.push({
      type: "text",
      start,
      end: pos - 1,
      content: precedingText
    });
    output.push({
      map: [line, line + 1],
      position: {
        start: pos - lineStart,
        end: pos - lineStart + text2.length
      },
      start: pos,
      end: pos + text2.length - 1,
      info: text2,
      ...tag
    });
    start = end + CLOSE.length;
    pos = start - 1;
  }
  output.push({
    type: "text",
    start,
    end: content.length - 1,
    content: content.slice(start)
  });
  return output;
}

// src/transformer.ts
var globalAttributes = {
  class: { type: Class, render: true },
  id: { type: Id, render: true }
};
var transformer_default = {
  findSchema(node2, { nodes = {}, tags = {} } = {}) {
    return node2.tag ? tags[node2.tag] : nodes[node2.type];
  },
  attributes(node2, config = {}) {
    const schema = this.findSchema(node2, config) ?? {};
    const output = {};
    const attrs = { ...globalAttributes, ...schema.attributes };
    for (const [key, attr] of Object.entries(attrs)) {
      if (attr.render == false)
        continue;
      const name = typeof attr.render === "string" ? attr.render : key;
      let value = node2.attributes[key];
      if (typeof attr.type === "function") {
        const instance = new attr.type();
        if (instance.transform) {
          value = instance.transform(value, config);
        }
      }
      value = value === void 0 ? attr.default : value;
      if (value === void 0)
        continue;
      output[name] = value;
    }
    if (schema.slots) {
      for (const [key, slot2] of Object.entries(schema.slots)) {
        if (slot2.render === false)
          continue;
        const name = typeof slot2.render === "string" ? slot2.render : key;
        if (node2.slots[key])
          output[name] = this.node(node2.slots[key], config);
      }
    }
    return output;
  },
  children(node2, config = {}) {
    const children = node2.children.flatMap((child) => this.node(child, config));
    if (children.some(isPromise)) {
      return Promise.all(children);
    }
    return children;
  },
  node(node2, config = {}) {
    const schema = this.findSchema(node2, config) ?? {};
    if (schema && schema.transform instanceof Function)
      return schema.transform(node2, config);
    const children = this.children(node2, config);
    if (!schema || !schema.render)
      return children;
    const attributes = this.attributes(node2, config);
    if (isPromise(attributes) || isPromise(children)) {
      return Promise.all([attributes, children]).then((values) => new Tag(schema.render, ...values));
    }
    return new Tag(schema.render, attributes, children);
  }
};

// src/ast/node.ts
var Node = class {
  constructor(type = "node", attributes = {}, children = [], tag) {
    this.$$mdtype = "Node";
    this.errors = [];
    this.lines = [];
    this.inline = false;
    this.attributes = attributes;
    this.children = children;
    this.type = type;
    this.tag = tag;
    this.annotations = [];
    this.slots = {};
  }
  *walk() {
    for (const child of [...Object.values(this.slots), ...this.children]) {
      yield child;
      yield* child.walk();
    }
  }
  push(node2) {
    this.children.push(node2);
  }
  resolve(config = {}) {
    return Object.assign(new Node(), this, {
      children: this.children.map((child) => child.resolve(config)),
      attributes: resolve(this.attributes, config),
      slots: Object.fromEntries(Object.entries(this.slots).map(([name, slot2]) => [
        name,
        slot2.resolve(config)
      ]))
    });
  }
  findSchema(config = {}) {
    return transformer_default.findSchema(this, config);
  }
  transformAttributes(config = {}) {
    return transformer_default.attributes(this, config);
  }
  transformChildren(config) {
    return transformer_default.children(this, config);
  }
  transform(config) {
    return transformer_default.node(this, config);
  }
};

// src/ast/index.ts
var AstTypes = {
  Function: Function2,
  Node,
  Variable
};
var ast_default = {
  ...AstTypes,
  ...base_exports};

// src/transforms/table.ts
function convertToRow(node2, cellType = "td") {
  node2.type = "tr";
  node2.attributes = {};
  for (const cell of node2.children)
    cell.type = cellType;
  return node2;
}
function transform(document2) {
  for (const node2 of document2.walk()) {
    if (node2.type !== "tag" || node2.tag !== "table")
      continue;
    const [first, ...rest] = node2.children;
    if (!first || first.type === "table")
      continue;
    const table3 = new ast_default.Node("table", node2.attributes, [
      new ast_default.Node("thead"),
      new ast_default.Node("tbody")
    ]);
    const [thead2, tbody2] = table3.children;
    if (first.type === "list")
      thead2.push(convertToRow(first, "th"));
    for (const row of rest) {
      if (row.type === "list")
        convertToRow(row);
      else if (row.type === "tag" && row.tag === "if") {
        const children = [];
        for (const child of row.children) {
          if (child.type === "hr")
            continue;
          if (child.type === "list")
            convertToRow(child);
          children.push(child);
        }
        row.children = children;
      } else
        continue;
      tbody2.push(row);
    }
    node2.children = [table3];
  }
}

// src/transforms/index.ts
var transforms_default = [transform];

// src/parser.ts
var mappings = {
  ordered_list: "list",
  bullet_list: "list",
  code_inline: "code",
  list_item: "item",
  variable: "text"
};
function annotate(node2, attributes) {
  for (const attribute of attributes) {
    node2.annotations.push(attribute);
    const { name, value, type } = attribute;
    if (type === "attribute") {
      if (node2.attributes[name] !== void 0)
        node2.errors.push({
          id: "duplicate-attribute",
          level: "warning",
          message: `Attribute '${name}' already set`
        });
      node2.attributes[name] = value;
    } else if (type === "class")
      if (node2.attributes.class)
        node2.attributes.class[name] = value;
      else
        node2.attributes.class = { [name]: value };
  }
}
function handleAttrs(token, type) {
  switch (type) {
    case "heading":
      return { level: Number(token.tag.replace("h", "")) };
    case "list": {
      const attrs = token.attrs ? Object.fromEntries(token.attrs) : void 0;
      const ordered = token.type.startsWith("ordered");
      return ordered && attrs?.start ? { ordered: true, start: attrs.start, marker: token.markup } : { ordered, marker: token.markup };
    }
    case "link": {
      const attrs = Object.fromEntries(token.attrs);
      return attrs.title ? { href: attrs.href, title: attrs.title } : { href: attrs.href };
    }
    case "image": {
      const attrs = Object.fromEntries(token.attrs);
      return attrs.title ? { alt: token.content, src: attrs.src, title: attrs.title } : { alt: token.content, src: attrs.src };
    }
    case "em":
    case "strong":
      return { marker: token.markup };
    case "text":
    case "code":
    case "comment":
      return { content: (token.meta || {}).variable || token.content };
    case "fence": {
      const [language] = token.info.split(" ", 1);
      return language === "" || language === OPEN ? { content: token.content } : { content: token.content, language };
    }
    case "td":
    case "th": {
      if (token.attrs) {
        const attrs = Object.fromEntries(token.attrs);
        let align;
        if (attrs.style) {
          if (attrs.style.includes("left")) {
            align = "left";
          } else if (attrs.style.includes("center")) {
            align = "center";
          } else if (attrs.style.includes("right")) {
            align = "right";
          }
        }
        if (align) {
          return { align };
        }
      }
      return {};
    }
    default:
      return {};
  }
}
function handleToken(token, nodes, file, handleSlots, addLocation, inlineParent) {
  if (token.type === "frontmatter") {
    nodes[0].attributes.frontmatter = token.content;
    return;
  }
  if (token.hidden || token.type === "text" && token.content === "")
    return;
  const errors = token.errors || [];
  const parent = nodes[nodes.length - 1];
  const { tag, attributes, error: error2 } = token.meta || {};
  if (token.type === "annotation") {
    if (inlineParent)
      return annotate(inlineParent, attributes);
    return parent.errors.push({
      id: "no-inline-annotations",
      level: "error",
      message: `Can't apply inline annotations to '${parent.type}'`
    });
  }
  let typeName = token.type.replace(/_(open|close)$/, "");
  if (mappings[typeName])
    typeName = mappings[typeName];
  if (typeName === "error") {
    const { message, location } = error2;
    errors.push({ id: "parse-error", level: "critical", message, location });
  }
  if (token.nesting < 0) {
    if (parent.type === typeName && parent.tag === tag) {
      if (parent.lines && token.map)
        parent.lines.push(...token.map);
      return nodes.pop();
    }
    errors.push({
      id: "missing-opening",
      level: "critical",
      message: `Node '${typeName}' is missing opening`
    });
  }
  const attrs = handleAttrs(token, typeName);
  const node2 = new Node(typeName, attrs, void 0, tag || void 0);
  const { position = {} } = token;
  node2.errors = errors;
  if (addLocation !== false) {
    node2.lines = token.map || parent.lines || [];
    node2.location = {
      file,
      start: {
        line: node2.lines[0],
        character: position.start
      },
      end: {
        line: node2.lines[1],
        character: position.end
      }
    };
  }
  if (inlineParent)
    node2.inline = true;
  if (attributes && ["tag", "fence", "image"].includes(typeName))
    annotate(node2, attributes);
  if (handleSlots && tag === "slot" && typeof node2.attributes.primary === "string")
    parent.slots[node2.attributes.primary] = node2;
  else
    parent.push(node2);
  if (token.nesting > 0)
    nodes.push(node2);
  if (!Array.isArray(token.children))
    return;
  if (node2.type === "inline")
    inlineParent = parent;
  nodes.push(node2);
  const isLeafNode = typeName === "image";
  if (!isLeafNode) {
    for (const child of token.children)
      handleToken(child, nodes, file, handleSlots, addLocation, inlineParent);
  }
  nodes.pop();
}
function parser(tokens, args) {
  const doc = new Node("document");
  const nodes = [doc];
  if (typeof args === "string")
    args = { file: args };
  for (const token of tokens)
    handleToken(token, nodes, args?.file, args?.slots, args?.location);
  if (nodes.length > 1)
    for (const node2 of nodes.slice(1))
      node2.errors.push({
        id: "missing-closing",
        level: "critical",
        message: `Node '${node2.tag || node2.type}' is missing closing`
      });
  for (const transform3 of transforms_default)
    transform3(doc);
  return doc;
}

// src/schema.ts
var schema_exports = {};
__export(schema_exports, {
  blockquote: () => blockquote,
  code: () => code,
  comment: () => comment,
  document: () => document$1,
  em: () => em,
  error: () => error,
  fence: () => fence,
  hardbreak: () => hardbreak,
  heading: () => heading,
  hr: () => hr,
  image: () => image$1,
  inline: () => inline,
  item: () => item,
  link: () => link,
  list: () => list,
  node: () => node,
  paragraph: () => paragraph,
  s: () => s,
  softbreak: () => softbreak,
  strong: () => strong,
  table: () => table,
  tbody: () => tbody,
  td: () => td,
  text: () => text$1,
  th: () => th,
  thead: () => thead,
  tr: () => tr
});
var document$1 = {
  render: "article",
  children: [
    "heading",
    "paragraph",
    "image",
    "table",
    "tag",
    "fence",
    "blockquote",
    "comment",
    "list",
    "hr"
  ],
  attributes: {
    frontmatter: { render: false }
  }
};
var heading = {
  children: ["inline"],
  attributes: {
    level: { type: Number, render: false, required: true }
  },
  transform(node2, config) {
    return new Tag(`h${node2.attributes["level"]}`, node2.transformAttributes(config), node2.transformChildren(config));
  }
};
var paragraph = {
  render: "p",
  children: ["inline"]
};
var image$1 = {
  render: "img",
  attributes: {
    src: { type: String, required: true },
    alt: { type: String },
    title: { type: String }
  }
};
var fence = {
  render: "pre",
  attributes: {
    content: { type: String, render: false, required: true },
    language: { type: String, render: "data-language" },
    process: { type: Boolean, render: false, default: true }
  },
  transform(node2, config) {
    const attributes = node2.transformAttributes(config);
    const children = node2.children.length ? node2.transformChildren(config) : [node2.attributes.content];
    return new Tag("pre", attributes, children);
  }
};
var blockquote = {
  render: "blockquote",
  children: [
    "heading",
    "paragraph",
    "image",
    "table",
    "tag",
    "fence",
    "blockquote",
    "list",
    "hr"
  ]
};
var item = {
  render: "li",
  children: [
    "inline",
    "heading",
    "paragraph",
    "image",
    "table",
    "tag",
    "fence",
    "blockquote",
    "list",
    "hr"
  ]
};
var list = {
  children: ["item"],
  attributes: {
    ordered: { type: Boolean, render: false, required: true },
    start: { type: Number },
    marker: { type: String, render: false }
  },
  transform(node2, config) {
    return new Tag(node2.attributes.ordered ? "ol" : "ul", node2.transformAttributes(config), node2.transformChildren(config));
  }
};
var hr = {
  render: "hr"
};
var table = {
  render: "table"
};
var td = {
  render: "td",
  children: [
    "inline",
    "heading",
    "paragraph",
    "image",
    "table",
    "tag",
    "fence",
    "blockquote",
    "list",
    "hr"
  ],
  attributes: {
    align: { type: String },
    colspan: { type: Number, render: "colSpan" },
    rowspan: { type: Number, render: "rowSpan" }
  }
};
var th = {
  render: "th",
  attributes: {
    width: { type: String },
    align: { type: String },
    colspan: { type: Number, render: "colSpan" },
    rowspan: { type: Number, render: "rowSpan" }
  }
};
var tr = {
  render: "tr",
  children: ["th", "td"]
};
var tbody = {
  render: "tbody",
  children: ["tr", "tag"]
};
var thead = {
  render: "thead",
  children: ["tr"]
};
var strong = {
  render: "strong",
  children: ["em", "s", "link", "code", "text", "tag"],
  attributes: {
    marker: { type: String, render: false }
  }
};
var em = {
  render: "em",
  children: ["strong", "s", "link", "code", "text", "tag"],
  attributes: {
    marker: { type: String, render: false }
  }
};
var s = {
  render: "s",
  children: ["strong", "em", "link", "code", "text", "tag"]
};
var inline = {
  children: [
    "strong",
    "em",
    "s",
    "code",
    "text",
    "tag",
    "link",
    "image",
    "hardbreak",
    "softbreak",
    "comment"
  ]
};
var link = {
  render: "a",
  children: ["strong", "em", "s", "code", "text", "tag"],
  attributes: {
    href: { type: String, required: true },
    title: { type: String }
  }
};
var code = {
  render: "code",
  attributes: {
    content: { type: String, render: false, required: true }
  },
  transform(node2, config) {
    const attributes = node2.transformAttributes(config);
    return new Tag("code", attributes, [node2.attributes.content]);
  }
};
var text$1 = {
  attributes: {
    content: { type: String, required: true }
  },
  transform(node2) {
    return node2.attributes.content;
  }
};
var hardbreak = {
  render: "br"
};
var softbreak = {
  transform() {
    return " ";
  }
};
var comment = {
  attributes: {
    content: { type: String, required: true }
  }
};
var error = {};
var node = {};

// src/renderers/html.ts
var import_markdown_it = __toModule(require_markdown_it());
var { escapeHtml } = (0, import_markdown_it.default)().utils;

// src/tokenizer/index.ts
var import_lib = __toModule(require_lib());

// src/tokenizer/plugins/annotations.ts
var import_tag7 = __toModule(require_tag());
function createToken(state, content, contentStart) {
  try {
    const { type, meta, nesting = 0 } = (0, import_tag7.parse)(content, { Variable, Function: Function2 });
    const token = state.push(type, "", nesting);
    token.info = content;
    token.meta = meta;
    if (!state.delimiters) {
      state.delimiters = [];
    }
    return token;
  } catch (error2) {
    if (!(error2 instanceof import_tag7.SyntaxError))
      throw error2;
    const {
      message,
      location: { start, end }
    } = error2;
    const location = contentStart ? {
      start: { offset: start.offset + contentStart },
      end: { offset: end.offset + contentStart }
    } : null;
    const token = state.push("error", "", 0);
    token.meta = { error: { message, location } };
    return token;
  }
}
function block(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const finish = state.eMarks[startLine];
  if (!state.src.startsWith(OPEN, start))
    return false;
  const tagEnd = findTagEnd(state.src, start);
  const lastPossible = state.src.slice(0, finish).trim().length;
  if (!tagEnd || tagEnd < lastPossible - CLOSE.length)
    return false;
  const contentStart = start + OPEN.length;
  const content = state.src.slice(contentStart, tagEnd).trim();
  const lines = state.src.slice(start, tagEnd + CLOSE.length).split("\n").length;
  if (content[0] === "$")
    return false;
  if (silent)
    return true;
  const token = createToken(state, content, contentStart);
  token.map = [startLine, startLine + lines];
  state.line += lines;
  return true;
}
function inline2(state, silent) {
  if (!state.src.startsWith(OPEN, state.pos))
    return false;
  const tagEnd = findTagEnd(state.src, state.pos);
  if (!tagEnd)
    return false;
  const content = state.src.slice(state.pos + OPEN.length, tagEnd);
  if (!silent)
    createToken(state, content.trim());
  state.pos = tagEnd + CLOSE.length;
  return true;
}
function core(state) {
  let token;
  for (token of state.tokens) {
    if (token.type !== "fence")
      continue;
    if (token.info.includes(OPEN)) {
      const start = token.info.indexOf(OPEN);
      const end = findTagEnd(token.info, start);
      const content = token.info.slice(start + OPEN.length, end);
      try {
        const { meta } = (0, import_tag7.parse)(content.trim(), { Variable, Function: Function2 });
        token.meta = meta;
      } catch (error2) {
        if (!(error2 instanceof import_tag7.SyntaxError))
          throw error2;
        if (!token.errors)
          token.errors = [];
        token.errors.push({
          id: "fence-tag-error",
          level: "error",
          message: `Syntax error in fence tag: ${error2.message}`
        });
      }
    }
    if (token?.meta?.attributes?.find((attr) => attr.name === "process" && !attr.value))
      continue;
    token.children = parseTags(token.content, token.map[0]);
  }
}
function plugin(md) {
  md.block.ruler.before("paragraph", "annotations", block, {
    alt: ["paragraph", "blockquote"]
  });
  md.inline.ruler.push("containers", inline2);
  md.core.ruler.push("annotations", core);
}

// src/tokenizer/plugins/frontmatter.ts
var fence2 = "---";
function getLine(state, n) {
  return state.src.slice(state.bMarks[n], state.eMarks[n]).trim();
}
function findClose(state, endLine) {
  for (let line = 1; line < endLine; line++)
    if (getLine(state, line) === fence2)
      return line;
}
function block2(state, startLine, endLine, silent) {
  if (startLine != 0 || getLine(state, 0) != fence2)
    return false;
  const close = findClose(state, endLine);
  if (!close)
    return false;
  if (silent)
    return true;
  const token = state.push("frontmatter", "", 0);
  token.content = state.src.slice(state.eMarks[0], state.bMarks[close]).trim();
  token.map = [0, close];
  token.hidden = true;
  state.line = close + 1;
  return true;
}
function plugin2(md) {
  md.block.ruler.before("hr", "frontmatter", block2);
}

// src/tokenizer/plugins/comments.ts
var OPEN2 = "<!--";
var CLOSE2 = "-->";
function block3(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  if (!state.src.startsWith(OPEN2, start))
    return false;
  const close = state.src.indexOf(CLOSE2, start);
  if (!close)
    return false;
  if (silent)
    return true;
  const content = state.src.slice(start + OPEN2.length, close);
  const lines = content.split("\n").length;
  const token = state.push("comment", "", 0);
  token.content = content.trim();
  token.map = [startLine, startLine + lines];
  state.line += lines;
  return true;
}
function inline3(state, silent) {
  if (!state.src.startsWith(OPEN2, state.pos))
    return false;
  const close = state.src.indexOf(CLOSE2, state.pos);
  if (!close)
    return false;
  if (silent)
    return true;
  const content = state.src.slice(state.pos + OPEN2.length, close);
  const token = state.push("comment", "", 0);
  token.content = content.trim();
  state.pos = close + CLOSE2.length;
  return true;
}
function plugin3(md) {
  md.block.ruler.before("table", "comment", block3, { alt: ["paragraph"] });
  md.inline.ruler.push("comment", inline3);
}

// src/tokenizer/index.ts
var Tokenizer = class {
  constructor(config = {}) {
    this.parser = new import_lib.default(config);
    this.parser.use(plugin, "annotations", {});
    this.parser.use(plugin2, "frontmatter", {});
    this.parser.disable([
      "lheading",
      "code"
    ]);
    if (config.allowComments)
      this.parser.use(plugin3, "comments", {});
  }
  tokenize(content) {
    return this.parser.parse(content.toString(), {});
  }
};

// index.ts
var tokenizer = new Tokenizer();
function parse3(content, args) {
  if (typeof content === "string")
    content = tokenizer.tokenize(content);
  return parser(content, args);
}

function assertNever(arg) {
  throw new Error("Expected never to be called, but received: " + JSON.stringify(arg));
}

/// <reference lib="es2020.promise" />
// Primitives
// ------------------------------

/** Checks whether a value is a string */

function isString(value) {
  return typeof value === 'string';
}

class FieldDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FieldDataError';
  }
}

function assertRequired(value, validation, label) {
  if (value === null && validation !== null && validation !== void 0 && validation.isRequired) {
    throw new FieldDataError(`${label} is required`);
  }
}
function basicFormFieldWithSimpleReaderParse(config) {
  return {
    kind: 'form',
    Input: config.Input,
    defaultValue: config.defaultValue,
    parse: config.parse,
    serialize: config.serialize,
    validate: config.validate,
    reader: {
      parse(value) {
        return config.validate(config.parse(value));
      }
    },
    label: config.label
  };
}

// this is used in react-server environments to avoid bundling UI when the reader API is used
// if you added a new field and get an error that there's missing a missing export here,
// you probably just need to add another empty export here

function empty$1() {
  throw new Error("unexpected call to function that shouldn't be called in React server component environment");
}
let SlugFieldInput = empty$1,
  TextFieldInput = empty$1,
  UrlFieldInput = empty$1,
  SelectFieldInput = empty$1,
  RelationshipInput = empty$1,
  PathReferenceInput = empty$1,
  MultiselectFieldInput = empty$1,
  MultiRelationshipInput = empty$1,
  IntegerFieldInput = empty$1,
  NumberFieldInput = empty$1,
  ImageFieldInput = empty$1,
  FileFieldInput = empty$1,
  DatetimeFieldInput = empty$1,
  DateFieldInput = empty$1,
  CloudImageFieldInput = empty$1,
  BlocksFieldInput = empty$1,
  DocumentFieldInput = empty$1,
  CheckboxFieldInput = empty$1,
  createEditorSchema = empty$1,
  getDefaultValue = empty$1,
  parseToEditorState = empty$1,
  serializeFromEditorState = empty$1,
  parseToEditorStateMDX = empty$1,
  serializeFromEditorStateMDX = empty$1,
  createEditorStateFromYJS = empty$1,
  prosemirrorToYXmlFragment = empty$1,
  normalizeDocumentFieldChildren = empty$1,
  slugify = empty$1,
  serializeMarkdoc = empty$1;

function validateText(val, min, max, fieldLabel, slugInfo, pattern) {
  if (val.length < min) {
    if (min === 1) {
      return `${fieldLabel} must not be empty`;
    } else {
      return `${fieldLabel} must be at least ${min} characters long`;
    }
  }
  if (val.length > max) {
    return `${fieldLabel} must be no longer than ${max} characters`;
  }
  if (pattern && !pattern.regex.test(val)) {
    return pattern.message || `${fieldLabel} must match the pattern ${pattern.regex}`;
  }
  if (slugInfo) {
    if (val === '') {
      return `${fieldLabel} must not be empty`;
    }
    if (val === '..') {
      return `${fieldLabel} must not be ..`;
    }
    if (val === '.') {
      return `${fieldLabel} must not be .`;
    }
    if (slugInfo.glob === '**') {
      const split = val.split('/');
      if (split.some(s => s === '..')) {
        return `${fieldLabel} must not contain ..`;
      }
      if (split.some(s => s === '.')) {
        return `${fieldLabel} must not be .`;
      }
    }
    if ((slugInfo.glob === '*' ? /[\\/]/ : /[\\]/).test(val)) {
      return `${fieldLabel} must not contain slashes`;
    }
    if (/^\s|\s$/.test(val)) {
      return `${fieldLabel} must not start or end with spaces`;
    }
    if (slugInfo.slugs.has(val)) {
      return `${fieldLabel} must be unique`;
    }
  }
}

function parseAsNormalField(value) {
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new FieldDataError('Must be a string');
  }
  return value;
}
const emptySet = new Set();
function text({
  label,
  defaultValue = '',
  validation: {
    length: {
      max = Infinity,
      min = 0
    } = {},
    pattern,
    isRequired
  } = {},
  description,
  multiline = false
}) {
  min = Math.max(isRequired ? 1 : 0, min);
  function validate(value, slugField) {
    const message = validateText(value, min, max, label, slugField, pattern);
    if (message !== undefined) {
      throw new FieldDataError(message);
    }
    return value;
  }
  return {
    kind: 'form',
    formKind: 'slug',
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(TextFieldInput, {
        label: label,
        description: description,
        min: min,
        max: max,
        multiline: multiline,
        pattern: pattern,
        ...props
      });
    },
    defaultValue() {
      return typeof defaultValue === 'string' ? defaultValue : defaultValue();
    },
    parse(value, args) {
      if ((args === null || args === void 0 ? void 0 : args.slug) !== undefined) {
        return args.slug;
      }
      return parseAsNormalField(value);
    },
    serialize(value) {
      return {
        value: value === '' ? undefined : value
      };
    },
    serializeWithSlug(value) {
      return {
        slug: value,
        value: undefined
      };
    },
    reader: {
      parse(value) {
        const parsed = parseAsNormalField(value);
        return validate(parsed, undefined);
      },
      parseWithSlug(_value, args) {
        validate(parseAsNormalField(args.slug), {
          glob: args.glob,
          slugs: emptySet
        });
        return null;
      }
    },
    validate(value, args) {
      return validate(value, args === null || args === void 0 ? void 0 : args.slugField);
    }
  };
}

function object(fields, opts) {
  return {
    ...opts,
    kind: 'object',
    fields
  };
}

function getValueAtPropPath(value, inputPath) {
  const path = [...inputPath];
  while (path.length) {
    const key = path.shift();
    value = value[key];
  }
  return value;
}
function transformProps(schema, value, visitors, path = []) {
  if (schema.kind === 'form' || schema.kind === 'child') {
    if (visitors[schema.kind]) {
      return visitors[schema.kind](schema, value, path);
    }
    return value;
  }
  if (schema.kind === 'object') {
    const val = Object.fromEntries(Object.entries(schema.fields).map(([key, val]) => {
      return [key, transformProps(val, value[key], visitors, [...path, key])];
    }));
    if (visitors.object) {
      return visitors[schema.kind](schema, val, path);
    }
    return val;
  }
  if (schema.kind === 'array') {
    const val = value.map((val, idx) => transformProps(schema.element, val, visitors, path.concat(idx)));
    if (visitors.array) {
      return visitors[schema.kind](schema, val, path);
    }
    return val;
  }
  if (schema.kind === 'conditional') {
    const discriminant = transformProps(schema.discriminant, value.discriminant, visitors, path.concat('discriminant'));
    const conditionalVal = transformProps(schema.values[discriminant.toString()], value.value, visitors, path.concat('value'));
    const val = {
      discriminant,
      value: conditionalVal
    };
    if (visitors.conditional) {
      return visitors[schema.kind](schema, val, path);
    }
    return val;
  }
  assertNever(schema);
}

// a v important note
// marks in the markdown ast/html are represented quite differently to how they are in slate
// if you had the markdown **something https://keystonejs.com something**
// the bold node is the parent of the link node
// but in slate, marks are only represented on text nodes

const currentlyActiveMarks = new Set();
const currentlyDisabledMarks = new Set();
let currentLink = null;
function addMarkToChildren(mark, cb) {
  const wasPreviouslyActive = currentlyActiveMarks.has(mark);
  currentlyActiveMarks.add(mark);
  try {
    return cb();
  } finally {
    if (!wasPreviouslyActive) {
      currentlyActiveMarks.delete(mark);
    }
  }
}
function setLinkForChildren(href, cb) {
  // we'll only use the outer link
  if (currentLink !== null) {
    return cb();
  }
  currentLink = href;
  try {
    return cb();
  } finally {
    currentLink = null;
  }
}

/**
 * This type is more strict than `Element & { type: 'link'; }` because `children`
 * is constrained to only contain Text nodes. This can't be assumed generally around the editor
 * (because of potentially future inline components or nested links(which are normalized away but the editor needs to not break if it happens))
 * but where this type is used, we're only going to allow links to contain Text and that's important
 * so that we know a block will never be inside an inline because Slate gets unhappy when that happens
 * (really the link inline should probably be a mark rather than an inline,
 * non-void inlines are probably always bad but that would imply changing the document
 * structure which would be such unnecessary breakage)
 */

function getInlineNodes(text) {
  const node = {
    text
  };
  for (const mark of currentlyActiveMarks) {
    if (!currentlyDisabledMarks.has(mark)) {
      node[mark] = true;
    }
  }
  if (currentLink !== null) {
    return [{
      text: ''
    }, {
      type: 'link',
      href: currentLink,
      children: [node]
    }, {
      text: ''
    }];
  }
  return [node];
}

class VariableChildFields extends Error {
  constructor() {
    super('There are a variable number of child fields');
  }
}
function findSingleChildField(schema) {
  try {
    const result = _findConstantChildFields(schema, [], new Set());
    if (result.length === 1) {
      return result[0];
    }
    return;
  } catch (err) {
    if (err instanceof VariableChildFields) {
      return;
    }
    throw err;
  }
}
function _findConstantChildFields(schema, path, seenSchemas) {
  if (seenSchemas.has(schema)) {
    return [];
  }
  seenSchemas.add(schema);
  switch (schema.kind) {
    case 'form':
      return [];
    case 'child':
      return [{
        relativePath: path,
        options: schema.options,
        kind: 'child'
      }];
    case 'conditional':
      {
        if (couldContainChildField(schema)) {
          throw new VariableChildFields();
        }
        return [];
      }
    case 'array':
      {
        if (schema.asChildTag) {
          const child = _findConstantChildFields(schema.element, [], seenSchemas);
          if (child.length > 1) {
            return [];
          }
          return [{
            kind: 'array',
            asChildTag: schema.asChildTag,
            field: schema,
            relativePath: path,
            child: child[0]
          }];
        }
        if (couldContainChildField(schema)) {
          throw new VariableChildFields();
        }
        return [];
      }
    case 'object':
      {
        const paths = [];
        for (const [key, value] of Object.entries(schema.fields)) {
          paths.push(..._findConstantChildFields(value, path.concat(key), seenSchemas));
        }
        return paths;
      }
  }
}
function couldContainChildField(schema, seen = new Set()) {
  if (seen.has(schema)) {
    return false;
  }
  seen.add(schema);
  switch (schema.kind) {
    case 'form':
      return false;
    case 'child':
      return true;
    case 'conditional':
      return Object.values(schema.values).some(value => couldContainChildField(value, seen));
    case 'object':
      return Object.keys(schema.fields).some(key => couldContainChildField(schema.fields[key], seen));
    case 'array':
      return couldContainChildField(schema.element, seen);
  }
}

function inlineNodeFromMarkdoc(node) {
  if (node.type === 'inline') {
    return inlineChildrenFromMarkdoc(node.children);
  }
  if (node.type === 'link') {
    return setLinkForChildren(node.attributes.href, () => inlineChildrenFromMarkdoc(node.children));
  }
  if (node.type === 'text') {
    return getInlineNodes(node.attributes.content);
  }
  if (node.type === 'strong') {
    return addMarkToChildren('bold', () => inlineChildrenFromMarkdoc(node.children));
  }
  if (node.type === 'code') {
    return addMarkToChildren('code', () => getInlineNodes(node.attributes.content));
  }
  if (node.type === 'em') {
    return addMarkToChildren('italic', () => inlineChildrenFromMarkdoc(node.children));
  }
  if (node.type === 's') {
    return addMarkToChildren('strikethrough', () => inlineChildrenFromMarkdoc(node.children));
  }
  if (node.type === 'tag') {
    if (node.tag === 'u') {
      return addMarkToChildren('underline', () => inlineChildrenFromMarkdoc(node.children));
    }
    if (node.tag === 'kbd') {
      return addMarkToChildren('keyboard', () => inlineChildrenFromMarkdoc(node.children));
    }
    if (node.tag === 'sub') {
      return addMarkToChildren('subscript', () => inlineChildrenFromMarkdoc(node.children));
    }
    if (node.tag === 'sup') {
      return addMarkToChildren('superscript', () => inlineChildrenFromMarkdoc(node.children));
    }
  }
  if (node.type === 'softbreak') {
    return getInlineNodes(' ');
  }
  if (node.type === 'hardbreak') {
    return getInlineNodes('\n');
  }
  if (node.tag === 'component-inline-prop' && Array.isArray(node.attributes.propPath) && node.attributes.propPath.every(x => typeof x === 'string' || typeof x === 'number')) {
    return {
      type: 'component-inline-prop',
      children: inlineFromMarkdoc(node.children),
      propPath: node.attributes.propPath
    };
  }
  throw new Error(`Unknown inline node type: ${node.type}`);
}
function inlineChildrenFromMarkdoc(nodes) {
  return nodes.flatMap(inlineNodeFromMarkdoc);
}
function inlineFromMarkdoc(nodes) {
  const transformedNodes = nodes.flatMap(inlineNodeFromMarkdoc);
  const nextNodes = [];
  let lastNode;
  for (const [idx, node] of transformedNodes.entries()) {
    var _lastNode;
    if (node.type === undefined && node.text === '' && ((_lastNode = lastNode) === null || _lastNode === void 0 ? void 0 : _lastNode.type) === undefined && idx !== transformedNodes.length - 1) {
      continue;
    }
    nextNodes.push(node);
    lastNode = node;
  }
  if (!nextNodes.length) {
    nextNodes.push({
      text: ''
    });
  }
  return nextNodes;
}
function fromMarkdoc(node, componentBlocks) {
  const nodes = node.children.flatMap(x => fromMarkdocNode(x, componentBlocks));
  if (nodes.length === 0) {
    return [{
      type: 'paragraph',
      children: [{
        text: ''
      }]
    }];
  }
  if (nodes[nodes.length - 1].type !== 'paragraph') {
    nodes.push({
      type: 'paragraph',
      children: [{
        text: ''
      }]
    });
  }
  return nodes;
}
function fromMarkdocNode(node, componentBlocks) {
  if (node.type === 'blockquote') {
    return {
      type: 'blockquote',
      children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
    };
  }
  if (node.type === 'fence') {
    const {
      language,
      content,
      ...rest
    } = node.attributes;
    return {
      type: 'code',
      children: [{
        text: content.replace(/\n$/, '')
      }],
      ...(typeof language === 'string' ? {
        language
      } : {}),
      ...rest
    };
  }
  if (node.type === 'heading') {
    return {
      ...node.attributes,
      level: node.attributes.level,
      type: 'heading',
      children: inlineFromMarkdoc(node.children)
    };
  }
  if (node.type === 'list') {
    return {
      type: node.attributes.ordered ? 'ordered-list' : 'unordered-list',
      children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
    };
  }
  if (node.type === 'item') {
    var _node$children$;
    const children = [{
      type: 'list-item-content',
      children: node.children.length ? inlineFromMarkdoc([node.children[0]]) : [{
        text: ''
      }]
    }];
    if (((_node$children$ = node.children[1]) === null || _node$children$ === void 0 ? void 0 : _node$children$.type) === 'list') {
      const list = node.children[1];
      children.push({
        type: list.attributes.ordered ? 'ordered-list' : 'unordered-list',
        children: list.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
      });
    }
    return {
      type: 'list-item',
      children
    };
  }
  if (node.type === 'paragraph') {
    if (node.children.length === 1 && node.children[0].type === 'inline' && node.children[0].children.length === 1 && node.children[0].children[0].type === 'image') {
      var _image$attributes$tit;
      const image = node.children[0].children[0];
      return {
        type: 'image',
        src: decodeURI(image.attributes.src),
        alt: image.attributes.alt,
        title: (_image$attributes$tit = image.attributes.title) !== null && _image$attributes$tit !== void 0 ? _image$attributes$tit : '',
        children: [{
          text: ''
        }]
      };
    }
    const children = inlineFromMarkdoc(node.children);
    if (children.length === 1 && children[0].type === 'component-inline-prop') {
      return children[0];
    }
    return {
      type: 'paragraph',
      children,
      textAlign: node.attributes.textAlign
    };
  }
  if (node.type === 'hr') {
    return {
      type: 'divider',
      children: [{
        text: ''
      }]
    };
  }
  if (node.type === 'table') {
    return {
      type: 'table',
      children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
    };
  }
  if (node.type === 'tbody') {
    return {
      type: 'table-body',
      children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
    };
  }
  if (node.type === 'thead') {
    if (!node.children.length) return [];
    return {
      type: 'table-head',
      children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
    };
  }
  if (node.type === 'tr') {
    return {
      type: 'table-row',
      children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
    };
  }
  if (node.type === 'td') {
    return {
      type: 'table-cell',
      children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
    };
  }
  if (node.type === 'th') {
    return {
      type: 'table-cell',
      header: true,
      children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
    };
  }
  if (node.type === 'tag') {
    if (node.tag === 'table') {
      return fromMarkdocNode(node.children[0], componentBlocks);
    }
    if (node.tag === 'layout') {
      return {
        type: 'layout',
        layout: node.attributes.layout,
        children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
      };
    }
    if (node.tag === 'layout-area') {
      return {
        type: 'layout-area',
        children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
      };
    }
    if (node.tag === 'component-block') {
      return {
        type: 'component-block',
        component: node.attributes.component,
        props: node.attributes.props,
        children: node.children.length === 0 ? [{
          type: 'component-inline-prop',
          children: [{
            text: ''
          }]
        }] : node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
      };
    }
    if (node.tag === 'component-block-prop' && Array.isArray(node.attributes.propPath) && node.attributes.propPath.every(x => typeof x === 'string' || typeof x === 'number')) {
      return {
        type: 'component-block-prop',
        children: node.children.flatMap(x => fromMarkdocNode(x, componentBlocks)),
        propPath: node.attributes.propPath
      };
    }
    if (node.tag) {
      const componentBlock = componentBlocks[node.tag];
      if (componentBlock) {
        const singleChildField = findSingleChildField({
          kind: 'object',
          fields: componentBlock.schema
        });
        if (singleChildField) {
          const newAttributes = JSON.parse(JSON.stringify(node.attributes));
          const children = [];
          toChildrenAndProps(node.children, children, newAttributes, singleChildField, [], componentBlocks);
          return {
            type: 'component-block',
            component: node.tag,
            props: newAttributes,
            children
          };
        }
        return {
          type: 'component-block',
          component: node.tag,
          props: node.attributes,
          children: node.children.length === 0 ? [{
            type: 'component-inline-prop',
            children: [{
              text: ''
            }]
          }] : node.children.flatMap(x => fromMarkdocNode(x, componentBlocks))
        };
      }
    }
    throw new Error(`Unknown tag: ${node.tag}`);
  }
  return inlineNodeFromMarkdoc(node);
}
function toChildrenAndProps(fromMarkdoc, resultingChildren, value, singleChildField, parentPropPath, componentBlocks) {
  if (singleChildField.kind === 'child') {
    const children = fromMarkdoc.flatMap(x => fromMarkdocNode(x, componentBlocks));
    resultingChildren.push({
      type: `component-${singleChildField.options.kind}-prop`,
      propPath: [...parentPropPath, ...singleChildField.relativePath],
      children
    });
  }
  if (singleChildField.kind === 'array') {
    const arr = [];
    for (let [idx, child] of fromMarkdoc.entries()) {
      if (child.type === 'paragraph') {
        child = child.children[0].children[0];
      }
      if (child.type !== 'tag') {
        throw new Error(`expected tag ${singleChildField.asChildTag}, found type: ${child.type}`);
      }
      if (child.tag !== singleChildField.asChildTag) {
        throw new Error(`expected tag ${singleChildField.asChildTag}, found tag: ${child.tag}`);
      }
      const attributes = JSON.parse(JSON.stringify(child.attributes));
      if (singleChildField.child) {
        toChildrenAndProps(child.children, resultingChildren, attributes, singleChildField.child, [...parentPropPath, ...singleChildField.relativePath, idx], componentBlocks);
      }
      arr.push(attributes);
    }
    const key = singleChildField.relativePath[singleChildField.relativePath.length - 1];
    const parent = getValueAtPropPath(value, singleChildField.relativePath.slice(0, -1));
    parent[key] = arr;
  }
}

function fixPath(path) {
  return path.replace(/^\.?\/+/, '').replace(/\/*$/, '');
}

function getSrcPrefix(publicPath, slug) {
  return typeof publicPath === 'string' ? `${publicPath.replace(/\/*$/, '')}/${slug === undefined ? '' : slug + '/'}` : '';
}

function deserializeFiles(nodes, componentBlocks, files, otherFiles, mode, documentFeatures, slug) {
  return nodes.map(node => {
    if (node.type === 'component-block') {
      const componentBlock = componentBlocks[node.component];
      if (!componentBlock) return node;
      const schema = object(componentBlock.schema);
      return {
        ...node,
        props: deserializeProps(schema, node.props, files, otherFiles, mode, slug)
      };
    }
    if (node.type === 'image' && typeof node.src === 'string' && mode === 'edit') {
      var _ref;
      const prefix = getSrcPrefixForImageBlock(documentFeatures, slug);
      const filename = node.src.slice(prefix.length);
      const content = (_ref = typeof documentFeatures.images === 'object' && typeof documentFeatures.images.directory === 'string' ? otherFiles.get(fixPath(documentFeatures.images.directory)) : files) === null || _ref === void 0 ? void 0 : _ref.get(filename);
      if (!content) {
        return {
          type: 'paragraph',
          children: [{
            text: `Missing image ${filename}`
          }]
        };
      }
      return {
        type: 'image',
        src: {
          filename,
          content
        },
        alt: node.alt,
        title: node.title,
        children: [{
          text: ''
        }]
      };
    }
    if (typeof node.type === 'string') {
      const children = deserializeFiles(node.children, componentBlocks, files, otherFiles, mode, documentFeatures, slug);
      return {
        ...node,
        children
      };
    }
    return node;
  });
}
function deserializeProps(schema, value, files, otherFiles, mode, slug) {
  return transformProps(schema, value, {
    form: (schema, value) => {
      if (schema.formKind === 'asset') {
        var _otherFiles$get;
        if (mode === 'read') {
          return schema.reader.parse(value);
        }
        const filename = schema.filename(value, {
          slug,
          suggestedFilenamePrefix: undefined
        });
        return schema.parse(value, {
          asset: filename ? schema.directory ? (_otherFiles$get = otherFiles.get(schema.directory)) === null || _otherFiles$get === void 0 ? void 0 : _otherFiles$get.get(filename) : files.get(filename) : undefined,
          slug
        });
      }
      if (schema.formKind === 'content' || schema.formKind === 'assets') {
        throw new Error('Not implemented');
      }
      if (mode === 'read') {
        return schema.reader.parse(value);
      }
      return schema.parse(value, undefined);
    }
  });
}
function getSrcPrefixForImageBlock(documentFeatures, slug) {
  return getSrcPrefix(typeof documentFeatures.images === 'object' ? documentFeatures.images.publicPath : undefined, slug);
}

const textEncoder$1 = new TextEncoder();
textEncoder$1.encode('tree ');

function collectDirectoriesUsedInSchemaInner(schema, directories, seenSchemas) {
  if (seenSchemas.has(schema)) {
    return;
  }
  seenSchemas.add(schema);
  if (schema.kind === 'array') {
    return collectDirectoriesUsedInSchemaInner(schema.element, directories, seenSchemas);
  }
  if (schema.kind === 'child') {
    return;
  }
  if (schema.kind === 'form') {
    if (schema.formKind === 'asset' && schema.directory !== undefined) {
      directories.add(fixPath(schema.directory));
    }
    if ((schema.formKind === 'content' || schema.formKind === 'assets') && schema.directories !== undefined) {
      for (const directory of schema.directories) {
        directories.add(fixPath(directory));
      }
    }
    return;
  }
  if (schema.kind === 'object') {
    for (const field of Object.values(schema.fields)) {
      collectDirectoriesUsedInSchemaInner(field, directories, seenSchemas);
    }
    return;
  }
  if (schema.kind === 'conditional') {
    for (const innerSchema of Object.values(schema.values)) {
      collectDirectoriesUsedInSchemaInner(innerSchema, directories, seenSchemas);
    }
    return;
  }
  assertNever(schema);
}
function collectDirectoriesUsedInSchema(schema) {
  const directories = new Set();
  collectDirectoriesUsedInSchemaInner(schema, directories, new Set());
  return directories;
}

const textDecoder$1 = new TextDecoder();
const defaultAltField$1 = text({
  label: 'Alt text',
  description: 'This text will be used by screen readers and search engines.'
});
const emptyTitleField$1 = basicFormFieldWithSimpleReaderParse({
  Input() {
    return null;
  },
  defaultValue() {
    return '';
  },
  parse(value) {
    if (value === undefined) return '';
    if (typeof value !== 'string') {
      throw new FieldDataError('Must be string');
    }
    return value;
  },
  validate(value) {
    return value;
  },
  serialize(value) {
    return {
      value
    };
  },
  label: 'Title'
});
function normaliseDocumentFeatures(config) {
  var _config$formatting, _formatting$alignment, _formatting$alignment2, _formatting$blockType, _formatting$inlineMar, _formatting$inlineMar2, _formatting$inlineMar3, _formatting$inlineMar4, _formatting$inlineMar5, _formatting$inlineMar6, _formatting$inlineMar7, _formatting$inlineMar8, _formatting$listTypes, _formatting$listTypes2, _imagesConfig$schema$, _imagesConfig$schema, _imagesConfig$schema$2, _imagesConfig$schema2;
  const formatting = config.formatting === true ? {
    // alignment: true, // not supported natively in markdown
    blockTypes: true,
    headingLevels: true,
    inlineMarks: true,
    listTypes: true,
    softBreaks: true
  } : (_config$formatting = config.formatting) !== null && _config$formatting !== void 0 ? _config$formatting : {};
  const imagesConfig = config.images === true ? {} : config.images;
  return {
    formatting: {
      alignment: formatting.alignment === true ? {
        center: true,
        end: true
      } : {
        center: !!((_formatting$alignment = formatting.alignment) !== null && _formatting$alignment !== void 0 && _formatting$alignment.center),
        end: !!((_formatting$alignment2 = formatting.alignment) !== null && _formatting$alignment2 !== void 0 && _formatting$alignment2.end)
      },
      blockTypes: (formatting === null || formatting === void 0 ? void 0 : formatting.blockTypes) === true ? {
        blockquote: true,
        code: {
          schema: object({})
        }
      } : {
        blockquote: !!((_formatting$blockType = formatting.blockTypes) !== null && _formatting$blockType !== void 0 && _formatting$blockType.blockquote),
        code: (_formatting$blockType2 => {
          if (((_formatting$blockType2 = formatting.blockTypes) === null || _formatting$blockType2 === void 0 ? void 0 : _formatting$blockType2.code) === undefined) {
            return false;
          }
          if (formatting.blockTypes.code === true || !formatting.blockTypes.code.schema) {
            return {
              schema: object({})
            };
          }
          for (const key of ['type', 'children', 'language']) {
            if (key in formatting.blockTypes.code.schema) {
              throw new Error(`"${key}" cannot be a key in the schema for code blocks`);
            }
          }
          return {
            schema: object(formatting.blockTypes.code.schema)
          };
        })()
      },
      headings: (_obj$schema => {
        const opt = formatting === null || formatting === void 0 ? void 0 : formatting.headingLevels;
        const obj = typeof opt === 'object' && 'levels' in opt ? opt : {
          levels: opt,
          schema: undefined
        };
        if (obj.schema) {
          for (const key of ['type', 'children', 'level', 'textAlign']) {
            if (key in obj.schema) {
              throw new Error(`"${key}" cannot be a key in the schema for headings`);
            }
          }
        }
        return {
          levels: [...new Set(obj.levels === true ? [1, 2, 3, 4, 5, 6] : obj.levels)],
          schema: object((_obj$schema = obj.schema) !== null && _obj$schema !== void 0 ? _obj$schema : {})
        };
      })(),
      inlineMarks: formatting.inlineMarks === true ? {
        bold: true,
        code: true,
        italic: true,
        keyboard: false,
        // not supported natively in markdown
        strikethrough: true,
        subscript: false,
        // not supported natively in markdown
        superscript: false,
        // not supported natively in markdown
        underline: false // not supported natively in markdown
      } : {
        bold: !!((_formatting$inlineMar = formatting.inlineMarks) !== null && _formatting$inlineMar !== void 0 && _formatting$inlineMar.bold),
        code: !!((_formatting$inlineMar2 = formatting.inlineMarks) !== null && _formatting$inlineMar2 !== void 0 && _formatting$inlineMar2.code),
        italic: !!((_formatting$inlineMar3 = formatting.inlineMarks) !== null && _formatting$inlineMar3 !== void 0 && _formatting$inlineMar3.italic),
        strikethrough: !!((_formatting$inlineMar4 = formatting.inlineMarks) !== null && _formatting$inlineMar4 !== void 0 && _formatting$inlineMar4.strikethrough),
        underline: !!((_formatting$inlineMar5 = formatting.inlineMarks) !== null && _formatting$inlineMar5 !== void 0 && _formatting$inlineMar5.underline),
        keyboard: !!((_formatting$inlineMar6 = formatting.inlineMarks) !== null && _formatting$inlineMar6 !== void 0 && _formatting$inlineMar6.keyboard),
        subscript: !!((_formatting$inlineMar7 = formatting.inlineMarks) !== null && _formatting$inlineMar7 !== void 0 && _formatting$inlineMar7.subscript),
        superscript: !!((_formatting$inlineMar8 = formatting.inlineMarks) !== null && _formatting$inlineMar8 !== void 0 && _formatting$inlineMar8.superscript)
      },
      listTypes: formatting.listTypes === true ? {
        ordered: true,
        unordered: true
      } : {
        ordered: !!((_formatting$listTypes = formatting.listTypes) !== null && _formatting$listTypes !== void 0 && _formatting$listTypes.ordered),
        unordered: !!((_formatting$listTypes2 = formatting.listTypes) !== null && _formatting$listTypes2 !== void 0 && _formatting$listTypes2.unordered)
      },
      softBreaks: !!formatting.softBreaks
    },
    links: !!config.links,
    layouts: [...new Set((config.layouts || []).map(x => JSON.stringify(x)))].map(x => JSON.parse(x)),
    dividers: !!config.dividers,
    images: imagesConfig === undefined ? false : {
      ...imagesConfig,
      schema: {
        alt: (_imagesConfig$schema$ = (_imagesConfig$schema = imagesConfig.schema) === null || _imagesConfig$schema === void 0 ? void 0 : _imagesConfig$schema.alt) !== null && _imagesConfig$schema$ !== void 0 ? _imagesConfig$schema$ : defaultAltField$1,
        title: (_imagesConfig$schema$2 = (_imagesConfig$schema2 = imagesConfig.schema) === null || _imagesConfig$schema2 === void 0 ? void 0 : _imagesConfig$schema2.title) !== null && _imagesConfig$schema$2 !== void 0 ? _imagesConfig$schema$2 : emptyTitleField$1
      }
    },
    tables: !!config.tables
  };
}

/**
 * @deprecated `fields.markdoc` has superseded this field. `fields.mdx` is also available if you prefer MDX.
 */
function document({
  label,
  componentBlocks = {},
  description,
  ...documentFeaturesConfig
}) {
  const documentFeatures = normaliseDocumentFeatures(documentFeaturesConfig);
  return {
    kind: 'form',
    formKind: 'content',
    defaultValue() {
      return [{
        type: 'paragraph',
        children: [{
          text: ''
        }]
      }];
    },
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(DocumentFieldInput, {
        componentBlocks: componentBlocks,
        description: description,
        label: label,
        documentFeatures: documentFeatures,
        ...props
      });
    },
    parse(_, data) {
      const markdoc = textDecoder$1.decode(data.content);
      fromMarkdoc(parse3(markdoc), componentBlocks);
      return deserializeFiles(normalizeDocumentFieldChildren(), componentBlocks, data.other, data.external, 'edit', documentFeatures, data.slug);
    },
    contentExtension: '.mdoc',
    validate(value) {
      return value;
    },
    directories: [...collectDirectoriesUsedInSchema(object(Object.fromEntries(Object.entries(componentBlocks).map(([name, block]) => [name, object(block.schema)])))), ...(typeof documentFeatures.images === 'object' && typeof documentFeatures.images.directory === 'string' ? [fixPath(documentFeatures.images.directory)] : [])],
    serialize(value, opts) {
      return serializeMarkdoc();
    },
    reader: {
      parse(value, data) {
        const markdoc = textDecoder$1.decode(data.content);
        const document = fromMarkdoc(parse3(markdoc), componentBlocks);
        return deserializeFiles(document, componentBlocks, new Map(), new Map(), 'read', documentFeatures, undefined);
      }
    }
  };
}

const defaultAltField = text({
  label: 'Alt text',
  description: 'This text will be used by screen readers and search engines.'
});
const emptyTitleField = basicFormFieldWithSimpleReaderParse({
  Input() {
    return null;
  },
  defaultValue() {
    return '';
  },
  parse(value) {
    if (value === undefined) return '';
    if (typeof value !== 'string') {
      throw new FieldDataError('Must be string');
    }
    return value;
  },
  validate(value) {
    return value;
  },
  serialize(value) {
    return {
      value
    };
  },
  label: 'Title'
});
function editorOptionsToConfig(options) {
  var _options$bold, _options$italic, _options$strikethroug, _options$code, _options$blockquote, _options$orderedList, _options$unorderedLis, _options$table, _options$link, _options$divider;
  return {
    bold: (_options$bold = options.bold) !== null && _options$bold !== void 0 ? _options$bold : true,
    italic: (_options$italic = options.italic) !== null && _options$italic !== void 0 ? _options$italic : true,
    strikethrough: (_options$strikethroug = options.strikethrough) !== null && _options$strikethroug !== void 0 ? _options$strikethroug : true,
    code: (_options$code = options.code) !== null && _options$code !== void 0 ? _options$code : true,
    heading: (() => {
      let levels = [];
      let levelsOpt = typeof options.heading === 'object' && !Array.isArray(options.heading) ? options.heading.levels : options.heading;
      if (levelsOpt === true || levelsOpt === undefined) {
        levels = [1, 2, 3, 4, 5, 6];
      }
      if (Array.isArray(levelsOpt)) {
        levels = levelsOpt;
      }
      return {
        levels,
        schema: options.heading && typeof options.heading === 'object' && 'schema' in options.heading ? options.heading.schema : {}
      };
    })(),
    blockquote: (_options$blockquote = options.blockquote) !== null && _options$blockquote !== void 0 ? _options$blockquote : true,
    orderedList: (_options$orderedList = options.orderedList) !== null && _options$orderedList !== void 0 ? _options$orderedList : true,
    unorderedList: (_options$unorderedLis = options.unorderedList) !== null && _options$unorderedLis !== void 0 ? _options$unorderedLis : true,
    table: (_options$table = options.table) !== null && _options$table !== void 0 ? _options$table : true,
    link: (_options$link = options.link) !== null && _options$link !== void 0 ? _options$link : true,
    image: options.image !== false ? ((_opts$transformFilena, _opts$schema$alt, _opts$schema, _opts$schema$title, _opts$schema2) => {
      const opts = options.image === true ? undefined : options.image;
      return {
        directory: opts === null || opts === void 0 ? void 0 : opts.directory,
        publicPath: opts === null || opts === void 0 ? void 0 : opts.publicPath,
        transformFilename: (_opts$transformFilena = opts === null || opts === void 0 ? void 0 : opts.transformFilename) !== null && _opts$transformFilena !== void 0 ? _opts$transformFilena : x => x,
        schema: {
          alt: (_opts$schema$alt = opts === null || opts === void 0 || (_opts$schema = opts.schema) === null || _opts$schema === void 0 ? void 0 : _opts$schema.alt) !== null && _opts$schema$alt !== void 0 ? _opts$schema$alt : defaultAltField,
          title: (_opts$schema$title = opts === null || opts === void 0 || (_opts$schema2 = opts.schema) === null || _opts$schema2 === void 0 ? void 0 : _opts$schema2.title) !== null && _opts$schema$title !== void 0 ? _opts$schema$title : emptyTitleField
        }
      };
    })() : undefined,
    divider: (_options$divider = options.divider) !== null && _options$divider !== void 0 ? _options$divider : true,
    codeBlock: options.codeBlock === false ? undefined : {
      schema: typeof options.codeBlock === 'object' ? options.codeBlock.schema : {}
    }
  };
}

function getTypeForField(field) {
  if (field.kind === 'object' || field.kind === 'conditional') {
    return {
      type: Object,
      required: true
    };
  }
  if (field.kind === 'array') {
    return {
      type: Array,
      required: true
    };
  }
  if (field.kind === 'child') {
    return {};
  }
  if (field.formKind === undefined) {
    if (typeof field.defaultValue === 'string' && 'options' in field && Array.isArray(field.options) && field.options.every(val => typeof val === 'object' && val !== null && 'value' in val && typeof val.value === 'string')) {
      return {
        type: String,
        matches: field.options.map(x => x.value),
        required: true
      };
    }
    if (typeof field.defaultValue === 'string') {
      let required = false;
      try {
        field.parse('');
      } catch {
        required = true;
      }
      return {
        type: String,
        required
      };
    }
    try {
      field.parse(1);
      return {
        type: Number
      };
    } catch {}
    if (typeof field.defaultValue === 'boolean') {
      return {
        type: Boolean,
        required: true
      };
    }
    return {};
  }
  if (field.formKind === 'slug') {
    let required = false;
    try {
      field.parse('', undefined);
    } catch {
      required = true;
    }
    return {
      type: String,
      required
    };
  }
  if (field.formKind === 'asset') {
    let required = false;
    try {
      field.validate(null);
    } catch {
      required = true;
    }
    return {
      type: String,
      required
    };
  }
  return {};
}
function fieldsToMarkdocAttributes(fields) {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => {
    const schema = getTypeForField(field);
    return [name, schema];
  }));
}
function createMarkdocConfig(opts) {
  const editorConfig = editorOptionsToConfig(opts.options || {});
  const config = {
    nodes: {
      ...schema_exports
    },
    tags: {}
  };
  if (editorConfig.heading.levels.length) {
    config.nodes.heading = {
      ...schema_exports.heading,
      attributes: {
        ...schema_exports.heading.attributes,
        ...fieldsToMarkdocAttributes(editorConfig.heading.schema)
      }
    };
  } else {
    config.nodes.heading = undefined;
  }
  if (!editorConfig.blockquote) {
    config.nodes.blockquote = undefined;
  }
  if (editorConfig.codeBlock) {
    config.nodes.fence = {
      ...schema_exports.fence,
      attributes: {
        ...schema_exports.fence.attributes,
        ...fieldsToMarkdocAttributes(editorConfig.codeBlock.schema)
      }
    };
  } else {
    config.nodes.fence = undefined;
  }
  if (!editorConfig.orderedList && !editorConfig.unorderedList) {
    config.nodes.list = undefined;
  }
  if (!editorConfig.bold) {
    config.nodes.strong = undefined;
  }
  if (!editorConfig.italic) {
    config.nodes.em = undefined;
  }
  if (!editorConfig.strikethrough) {
    config.nodes.s = undefined;
  }
  if (!editorConfig.link) {
    config.nodes.link = undefined;
  }
  if (!editorConfig.image) {
    config.nodes.image = undefined;
  }
  if (!editorConfig.divider) {
    config.nodes.hr = undefined;
  }
  if (!editorConfig.table) {
    config.nodes.table = undefined;
  }
  for (const [name, component] of Object.entries(opts.components || {})) {
    var _opts$render;
    const isEmpty = component.kind === 'block' || component.kind === 'inline';
    config.tags[name] = {
      render: (_opts$render = opts.render) === null || _opts$render === void 0 || (_opts$render = _opts$render.tags) === null || _opts$render === void 0 ? void 0 : _opts$render[name],
      children: isEmpty ? [] : undefined,
      selfClosing: isEmpty,
      attributes: fieldsToMarkdocAttributes(component.schema),
      description: 'description' in component ? component.description : undefined,
      inline: component.kind === 'inline' || component.kind === 'mark'
    };
  }
  for (const [name, render] of Object.entries(((_opts$render2 = opts.render) === null || _opts$render2 === void 0 ? void 0 : _opts$render2.nodes) || {})) {
    var _opts$render2;
    const nodeSchema = config.nodes[name];
    if (nodeSchema) {
      nodeSchema.render = render;
    }
  }
  return config;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
function getDirectoriesForEditorField(components, config) {
  return [...collectDirectoriesUsedInSchema(object(Object.fromEntries(Object.entries(components).map(([name, component]) => [name, object(component.schema)])))), ...(typeof config.image === 'object' && typeof config.image.directory === 'string' ? [fixPath(config.image.directory)] : [])];
}
function markdoc({
  label,
  description,
  options = {},
  components = {},
  extension = 'mdoc'
}) {
  let schema;
  const config = editorOptionsToConfig(options);
  let getSchema = () => {
    if (!schema) {
      schema = createEditorSchema();
    }
    return schema;
  };
  return {
    kind: 'form',
    formKind: 'content',
    defaultValue() {
      return getDefaultValue(getSchema());
    },
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(DocumentFieldInput, {
        description: description,
        label: label,
        ...props
      });
    },
    parse: (_, {
      content,
      other,
      external,
      slug
    }) => {
      const text = textDecoder.decode(content);
      return parseToEditorState(text, getSchema());
    },
    contentExtension: `.${extension}`,
    validate(value) {
      return value;
    },
    directories: getDirectoriesForEditorField(components, config),
    serialize(value, {
      slug
    }) {
      const out = serializeFromEditorState();
      return {
        content: textEncoder.encode(out.content),
        external: out.external,
        other: out.other,
        value: undefined
      };
    },
    reader: {
      parse: (_, {
        content
      }) => {
        const text = textDecoder.decode(content);
        return {
          node: parse3(text)
        };
      }
    },
    collaboration: {
      toYjs(value) {
        return prosemirrorToYXmlFragment(value.doc);
      },
      fromYjs(yjsValue, awareness) {
        return createEditorStateFromYJS(getSchema());
      }
    }
  };
}
markdoc.createMarkdocConfig = createMarkdocConfig;
markdoc.inline = function inlineMarkdoc({
  label,
  description,
  options = {},
  components = {}
}) {
  let schema;
  const config = editorOptionsToConfig(options);
  let getSchema = () => {
    if (!schema) {
      schema = createEditorSchema();
    }
    return schema;
  };
  return {
    kind: 'form',
    formKind: 'assets',
    defaultValue() {
      return getDefaultValue(getSchema());
    },
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(DocumentFieldInput, {
        description: description,
        label: label,
        ...props
      });
    },
    parse: (value, {
      other,
      external,
      slug
    }) => {
      if (value === undefined) {
        value = '';
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      return parseToEditorState(value, getSchema());
    },
    validate(value) {
      return value;
    },
    directories: getDirectoriesForEditorField(components, config),
    serialize(value, {
      slug
    }) {
      const out = serializeFromEditorState();
      return {
        external: out.external,
        other: out.other,
        value: out.content
      };
    },
    reader: {
      parse: value => {
        if (value === undefined) {
          value = '';
        }
        if (typeof value !== 'string') {
          throw new FieldDataError('Must be a string');
        }
        return {
          node: parse3(value)
        };
      }
    },
    collaboration: {
      toYjs(value) {
        return prosemirrorToYXmlFragment(value.doc);
      },
      fromYjs(yjsValue, awareness) {
        return createEditorStateFromYJS(getSchema());
      }
    }
  };
};
function mdx({
  label,
  description,
  options = {},
  components = {},
  extension = 'mdx'
}) {
  let schema;
  const config = editorOptionsToConfig(options);
  let getSchema = () => {
    if (!schema) {
      schema = createEditorSchema();
    }
    return schema;
  };
  return {
    kind: 'form',
    formKind: 'content',
    defaultValue() {
      return getDefaultValue(getSchema());
    },
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(DocumentFieldInput, {
        description: description,
        label: label,
        ...props
      });
    },
    parse: (_, {
      content,
      other,
      external,
      slug
    }) => {
      const text = textDecoder.decode(content);
      return parseToEditorStateMDX(text, getSchema());
    },
    contentExtension: `.${extension}`,
    validate(value) {
      return value;
    },
    directories: getDirectoriesForEditorField(components, config),
    serialize(value, {
      slug
    }) {
      const out = serializeFromEditorStateMDX();
      return {
        content: textEncoder.encode(out.content),
        external: out.external,
        other: out.other,
        value: undefined
      };
    },
    reader: {
      parse: (_, {
        content
      }) => {
        const text = textDecoder.decode(content);
        return text;
      }
    },
    collaboration: {
      toYjs(value) {
        return prosemirrorToYXmlFragment(value.doc);
      },
      fromYjs(yjsValue, awareness) {
        return createEditorStateFromYJS(getSchema());
      }
    }
  };
}
mdx.inline = function mdx({
  label,
  description,
  options = {},
  components = {}
}) {
  let schema;
  const config = editorOptionsToConfig(options);
  let getSchema = () => {
    if (!schema) {
      schema = createEditorSchema();
    }
    return schema;
  };
  return {
    kind: 'form',
    formKind: 'assets',
    defaultValue() {
      return getDefaultValue(getSchema());
    },
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(DocumentFieldInput, {
        description: description,
        label: label,
        ...props
      });
    },
    parse: (value, {
      other,
      external,
      slug
    }) => {
      if (value === undefined) {
        value = '';
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      return parseToEditorStateMDX(value, getSchema());
    },
    validate(value) {
      return value;
    },
    directories: getDirectoriesForEditorField(components, config),
    serialize(value, {
      slug
    }) {
      const out = serializeFromEditorStateMDX();
      return {
        external: out.external,
        other: out.other,
        value: out.content
      };
    },
    reader: {
      parse: value => {
        if (value === undefined) {
          value = '';
        }
        if (typeof value !== 'string') {
          throw new FieldDataError('Must be a string');
        }
        return value;
      }
    },
    collaboration: {
      toYjs(value) {
        return prosemirrorToYXmlFragment(value.doc);
      },
      fromYjs(yjsValue, awareness) {
        return createEditorStateFromYJS(getSchema());
      }
    }
  };
};

var dist = {};

(function (exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.sanitizeUrl = exports.BLANK_URL = void 0;
	var invalidProtocolRegex = /^([^\w]*)(javascript|data|vbscript)/im;
	var htmlEntitiesRegex = /&#(\w+)(^\w|;)?/g;
	var htmlCtrlEntityRegex = /&(newline|tab);/gi;
	var ctrlCharactersRegex = /[\u0000-\u001F\u007F-\u009F\u2000-\u200D\uFEFF]/gim;
	var urlSchemeRegex = /^.+(:|&colon;)/gim;
	var relativeFirstCharacters = [".", "/"];
	exports.BLANK_URL = "about:blank";
	function isRelativeUrlWithoutProtocol(url) {
	    return relativeFirstCharacters.indexOf(url[0]) > -1;
	}
	// adapted from https://stackoverflow.com/a/29824550/2601552
	function decodeHtmlCharacters(str) {
	    var removedNullByte = str.replace(ctrlCharactersRegex, "");
	    return removedNullByte.replace(htmlEntitiesRegex, function (match, dec) {
	        return String.fromCharCode(dec);
	    });
	}
	function sanitizeUrl(url) {
	    if (!url) {
	        return exports.BLANK_URL;
	    }
	    var sanitizedUrl = decodeHtmlCharacters(url)
	        .replace(htmlCtrlEntityRegex, "")
	        .replace(ctrlCharactersRegex, "")
	        .trim();
	    if (!sanitizedUrl) {
	        return exports.BLANK_URL;
	    }
	    if (isRelativeUrlWithoutProtocol(sanitizedUrl)) {
	        return sanitizedUrl;
	    }
	    var urlSchemeParseResults = sanitizedUrl.match(urlSchemeRegex);
	    if (!urlSchemeParseResults) {
	        return sanitizedUrl;
	    }
	    var urlScheme = urlSchemeParseResults[0];
	    if (invalidProtocolRegex.test(urlScheme)) {
	        return exports.BLANK_URL;
	    }
	    return sanitizedUrl;
	}
	exports.sanitizeUrl = sanitizeUrl; 
} (dist));

function validateInteger(validation, value, label) {
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value))) {
    return `${label} must be a whole number`;
  }
  if (validation !== null && validation !== void 0 && validation.isRequired && value === null) {
    return `${label} is required`;
  }
  if (value !== null) {
    if ((validation === null || validation === void 0 ? void 0 : validation.min) !== undefined && value < validation.min) {
      return `${label} must be at least ${validation.min}`;
    }
    if ((validation === null || validation === void 0 ? void 0 : validation.max) !== undefined && value > validation.max) {
      return `${label} must be at most ${validation.max}`;
    }
  }
}

function integer({
  label,
  defaultValue,
  validation,
  description
}) {
  return basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(IntegerFieldInput, {
        label: label,
        description: description,
        validation: validation,
        ...props
      });
    },
    defaultValue() {
      return defaultValue !== null && defaultValue !== void 0 ? defaultValue : null;
    },
    parse(value) {
      if (value === undefined) {
        return null;
      }
      if (typeof value === 'number') {
        return value;
      }
      throw new FieldDataError('Must be a number');
    },
    validate(value) {
      const message = validateInteger(validation, value, label);
      if (message !== undefined) {
        throw new FieldDataError(message);
      }
      assertRequired(value, validation, label);
      return value;
    },
    serialize(value) {
      return {
        value: value === null ? undefined : value
      };
    }
  });
}

// Common

// Storage
// ----------------------------------------------------------------------------

// ============================================================================
// Functions
// ============================================================================

function config$1(config) {
  return config;
}
function collection(collection) {
  return collection;
}

function array(element, opts) {
  var _opts$label;
  return {
    kind: 'array',
    element,
    label: (_opts$label = opts === null || opts === void 0 ? void 0 : opts.label) !== null && _opts$label !== void 0 ? _opts$label : 'Items',
    description: opts === null || opts === void 0 ? void 0 : opts.description,
    itemLabel: opts === null || opts === void 0 ? void 0 : opts.itemLabel,
    asChildTag: opts === null || opts === void 0 ? void 0 : opts.asChildTag,
    slugField: opts === null || opts === void 0 ? void 0 : opts.slugField,
    validation: opts === null || opts === void 0 ? void 0 : opts.validation
  };
}

function select({
  label,
  options,
  defaultValue,
  description
}) {
  const optionValuesSet = new Set(options.map(x => x.value));
  if (!optionValuesSet.has(defaultValue)) {
    throw new Error(`A defaultValue of ${defaultValue} was provided to a select field but it does not match the value of one of the options provided`);
  }
  const field = basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(SelectFieldInput, {
        label: label,
        options: options,
        description: description,
        ...props
      });
    },
    defaultValue() {
      return defaultValue;
    },
    parse(value) {
      if (value === undefined) {
        return defaultValue;
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      if (!optionValuesSet.has(value)) {
        throw new FieldDataError('Must be a valid option');
      }
      return value;
    },
    validate(value) {
      return value;
    },
    serialize(value) {
      return {
        value
      };
    }
  });
  return {
    ...field,
    options
  };
}

function conditional(discriminant, values) {
  return {
    kind: 'conditional',
    discriminant,
    values: values
  };
}

function blocks(blocks, opts) {
  const entries = Object.entries(blocks);
  if (!entries.length) {
    throw new Error('fields.blocks must have at least one entry');
  }
  const select$1 = select({
    label: 'Kind',
    defaultValue: entries[0][0],
    options: Object.entries(blocks).map(([key, {
      label
    }]) => ({
      label,
      value: key
    }))
  });
  const element = conditional(select$1, Object.fromEntries(entries.map(([key, {
    schema
  }]) => [key, schema])));
  return {
    ...array(element, {
      label: opts.label,
      description: opts.description,
      validation: opts.validation,
      itemLabel(props) {
        const kind = props.discriminant;
        const block = blocks[kind];
        if (!block.itemLabel) return block.label;
        return block.itemLabel(props.value);
      }
    }),
    Input: BlocksFieldInput
  };
}

function checkbox({
  label,
  defaultValue = false,
  description
}) {
  return basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(CheckboxFieldInput, {
        ...props,
        label: label,
        description: description
      });
    },
    defaultValue() {
      return defaultValue;
    },
    parse(value) {
      if (value === undefined) return defaultValue;
      if (typeof value !== 'boolean') {
        throw new FieldDataError('Must be a boolean');
      }
      return value;
    },
    validate(value) {
      return value;
    },
    serialize(value) {
      return {
        value
      };
    }
  });
}

function child(options) {
  return {
    kind: 'child',
    options: options.kind === 'block' ? {
      ...options,
      dividers: options.dividers,
      formatting: options.formatting === 'inherit' ? {
        blockTypes: 'inherit',
        headingLevels: 'inherit',
        inlineMarks: 'inherit',
        listTypes: 'inherit',
        alignment: 'inherit',
        softBreaks: 'inherit'
      } : options.formatting,
      links: options.links,
      images: options.images,
      tables: options.tables,
      componentBlocks: options.componentBlocks
    } : {
      kind: 'inline',
      placeholder: options.placeholder,
      formatting: options.formatting === 'inherit' ? {
        inlineMarks: 'inherit',
        softBreaks: 'inherit'
      } : options.formatting,
      links: options.links
    }
  };
}

function cloudImage({
  label,
  description,
  validation
}) {
  return {
    ...object({
      src: text({
        label: 'URL',
        validation: {
          length: {
            min: validation !== null && validation !== void 0 && validation.isRequired ? 1 : 0
          }
        }
      }),
      alt: text({
        label: 'Alt text'
      }),
      height: integer({
        label: 'Height'
      }),
      width: integer({
        label: 'Width'
      })
    }, {
      label,
      description
    }),
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(CloudImageFieldInput, {
        ...props,
        isRequired: validation === null || validation === void 0 ? void 0 : validation.isRequired
      });
    }
  };
}

function validateDate(validation, value, label) {
  if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${label} is not a valid date`;
  }
  if (validation !== null && validation !== void 0 && validation.isRequired && value === null) {
    return `${label} is required`;
  }
  if ((validation !== null && validation !== void 0 && validation.min || validation !== null && validation !== void 0 && validation.max) && value !== null) {
    const date = new Date(value);
    if ((validation === null || validation === void 0 ? void 0 : validation.min) !== undefined) {
      const min = new Date(validation.min);
      if (date < min) {
        return `${label} must be after ${min.toLocaleDateString()}`;
      }
    }
    if ((validation === null || validation === void 0 ? void 0 : validation.max) !== undefined) {
      const max = new Date(validation.max);
      if (date > max) {
        return `${label} must be no later than ${max.toLocaleDateString()}`;
      }
    }
  }
}

function date({
  label,
  defaultValue,
  validation,
  description
}) {
  return basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(DateFieldInput, {
        validation: validation,
        label: label,
        description: description,
        ...props
      });
    },
    defaultValue() {
      if (defaultValue === undefined) {
        return null;
      }
      if (typeof defaultValue === 'string') {
        return defaultValue;
      }
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },
    parse(value) {
      if (value === undefined) {
        return null;
      }
      if (value instanceof Date) {
        const year = value.getUTCFullYear();
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        const day = String(value.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      return value;
    },
    serialize(value) {
      if (value === null) return {
        value: undefined
      };
      const date = new Date(value);
      date.toISOString = () => value;
      date.toString = () => value;
      return {
        value: date
      };
    },
    validate(value) {
      const message = validateDate(validation, value, label);
      if (message !== undefined) {
        throw new FieldDataError(message);
      }
      assertRequired(value, validation, label);
      return value;
    }
  });
}

function validateDatetime(validation, value, label) {
  if (value !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return `${label} is not a valid datetime`;
  }
  if (validation !== null && validation !== void 0 && validation.isRequired && value === null) {
    return `${label} is required`;
  }
  if ((validation !== null && validation !== void 0 && validation.min || validation !== null && validation !== void 0 && validation.max) && value !== null) {
    const datetime = new Date(value);
    if ((validation === null || validation === void 0 ? void 0 : validation.min) !== undefined) {
      const min = new Date(validation.min);
      if (datetime < min) {
        return `${label} must be after ${min.toISOString()}`;
      }
    }
    if ((validation === null || validation === void 0 ? void 0 : validation.max) !== undefined) {
      const max = new Date(validation.max);
      if (datetime > max) {
        return `${label} must be no later than ${max.toISOString()}`;
      }
    }
  }
}

function datetime({
  label,
  defaultValue,
  validation,
  description
}) {
  return basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(DatetimeFieldInput, {
        validation: validation,
        label: label,
        description: description,
        ...props
      });
    },
    defaultValue() {
      if (defaultValue === undefined) {
        return null;
      }
      if (typeof defaultValue === 'string') {
        return defaultValue;
      }
      if (defaultValue.kind === 'now') {
        const now = new Date();
        return new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, -8);
      }
      return null;
    },
    parse(value) {
      if (value === undefined) {
        return null;
      }
      if (value instanceof Date) {
        return value.toISOString().slice(0, -8);
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string or date');
      }
      return value;
    },
    serialize(value) {
      if (value === null) return {
        value: undefined
      };
      const date = new Date(value + 'Z');
      date.toJSON = () => date.toISOString().slice(0, -8);
      date.toString = () => date.toISOString().slice(0, -8);
      return {
        value: date
      };
    },
    validate(value) {
      const message = validateDatetime(validation, value, label);
      if (message !== undefined) {
        throw new FieldDataError(message);
      }
      assertRequired(value, validation, label);
      return value;
    }
  });
}

function empty() {
  return basicFormFieldWithSimpleReaderParse({
    Input() {
      return null;
    },
    defaultValue() {
      return null;
    },
    parse() {
      return null;
    },
    serialize() {
      return {
        value: undefined
      };
    },
    validate(value) {
      return value;
    },
    label: 'Empty'
  });
}

/**
 * @deprecated `emptyDocument` has been replaced with the `emptyContent` field
 */
function emptyDocument() {
  return {
    kind: 'form',
    formKind: 'content',
    Input() {
      return null;
    },
    defaultValue() {
      return null;
    },
    parse() {
      return null;
    },
    contentExtension: '.mdoc',
    serialize() {
      return {
        value: undefined,
        content: new Uint8Array(),
        external: new Map(),
        other: new Map()
      };
    },
    validate(value) {
      return value;
    },
    reader: {
      parse() {
        return null;
      }
    }
  };
}

function emptyContent(opts) {
  return {
    kind: 'form',
    formKind: 'content',
    Input() {
      return null;
    },
    defaultValue() {
      return null;
    },
    parse() {
      return null;
    },
    contentExtension: `.${opts.extension}`,
    serialize() {
      return {
        value: undefined,
        content: new Uint8Array(),
        external: new Map(),
        other: new Map()
      };
    },
    validate(value) {
      return value;
    },
    reader: {
      parse() {
        return null;
      }
    }
  };
}

function file({
  label,
  directory,
  validation,
  description,
  publicPath,
  transformFilename
}) {
  return {
    kind: 'form',
    formKind: 'asset',
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(FileFieldInput, {
        label: label,
        description: description,
        validation: validation,
        transformFilename: transformFilename,
        ...props
      });
    },
    defaultValue() {
      return null;
    },
    filename(value, args) {
      if (typeof value === 'string') {
        return value.slice(getSrcPrefix(publicPath, args.slug).length);
      }
      return undefined;
    },
    parse(value, args) {
      var _value$match$, _value$match;
      if (value === undefined) {
        return null;
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      if (args.asset === undefined) {
        return null;
      }
      return {
        data: args.asset,
        filename: value.slice(getSrcPrefix(publicPath, args.slug).length),
        extension: (_value$match$ = (_value$match = value.match(/\.([^.]+$)/)) === null || _value$match === void 0 ? void 0 : _value$match[1]) !== null && _value$match$ !== void 0 ? _value$match$ : ''
      };
    },
    validate(value) {
      assertRequired(value, validation, label);
      return value;
    },
    serialize(value, args) {
      if (value === null) {
        return {
          value: undefined,
          asset: undefined
        };
      }
      const filename = args.suggestedFilenamePrefix ? args.suggestedFilenamePrefix + '.' + value.extension : value.filename;
      return {
        value: `${getSrcPrefix(publicPath, args.slug)}${filename}`,
        asset: {
          filename,
          content: value.data
        }
      };
    },
    directory: directory ? fixPath(directory) : undefined,
    reader: {
      parse(value) {
        if (typeof value !== 'string' && value !== undefined) {
          throw new FieldDataError('Must be a string');
        }
        const val = value === undefined ? null : value;
        assertRequired(val, validation, label);
        return val;
      }
    }
  };
}

function image({
  label,
  directory,
  validation,
  description,
  publicPath,
  transformFilename
}) {
  return {
    kind: 'form',
    formKind: 'asset',
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(ImageFieldInput, {
        label: label,
        description: description,
        validation: validation,
        transformFilename: transformFilename,
        ...props
      });
    },
    defaultValue() {
      return null;
    },
    filename(value, args) {
      if (typeof value === 'string') {
        return value.slice(getSrcPrefix(publicPath, args.slug).length);
      }
      return undefined;
    },
    parse(value, args) {
      var _value$match$, _value$match;
      if (value === undefined) {
        return null;
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      if (args.asset === undefined) {
        return null;
      }
      return {
        data: args.asset,
        filename: value.slice(getSrcPrefix(publicPath, args.slug).length),
        extension: (_value$match$ = (_value$match = value.match(/\.([^.]+$)/)) === null || _value$match === void 0 ? void 0 : _value$match[1]) !== null && _value$match$ !== void 0 ? _value$match$ : ''
      };
    },
    validate(value) {
      assertRequired(value, validation, label);
      return value;
    },
    serialize(value, args) {
      if (value === null) {
        return {
          value: undefined,
          asset: undefined
        };
      }
      const filename = args.suggestedFilenamePrefix ? args.suggestedFilenamePrefix + '.' + value.extension : value.filename;
      return {
        value: `${getSrcPrefix(publicPath, args.slug)}${filename}`,
        asset: {
          filename,
          content: value.data
        }
      };
    },
    directory: directory ? fixPath(directory) : undefined,
    reader: {
      parse(value) {
        if (typeof value !== 'string' && value !== undefined) {
          throw new FieldDataError('Must be a string');
        }
        const val = value === undefined ? null : value;
        assertRequired(val, validation, label);
        return val;
      }
    }
  };
}

function pluralize(count, options) {
  const {
    singular,
    plural = singular + 's',
    inclusive = true
  } = options;
  const variant = count === 1 ? singular : plural;
  return inclusive ? `${count} ${variant}` : variant;
}

function validateMultiRelationshipLength(validation, value) {
  var _validation$length$mi, _validation$length, _validation$length$ma, _validation$length2;
  const minLength = (_validation$length$mi = validation === null || validation === void 0 || (_validation$length = validation.length) === null || _validation$length === void 0 ? void 0 : _validation$length.min) !== null && _validation$length$mi !== void 0 ? _validation$length$mi : 0;
  if (value.length < minLength) {
    return `Must have at least ${pluralize(minLength, {
      singular: 'item'
    })}.`;
  }
  const maxLength = (_validation$length$ma = validation === null || validation === void 0 || (_validation$length2 = validation.length) === null || _validation$length2 === void 0 ? void 0 : _validation$length2.max) !== null && _validation$length$ma !== void 0 ? _validation$length$ma : Infinity;
  if (value.length > maxLength) {
    return `Must have at most ${pluralize(maxLength, {
      singular: 'item'
    })}.`;
  }
}

function multiRelationship({
  label,
  collection,
  validation,
  description
}) {
  return basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(MultiRelationshipInput, {
        label: label,
        collection: collection,
        description: description,
        validation: validation,
        ...props
      });
    },
    defaultValue() {
      return [];
    },
    parse(value) {
      if (value === undefined) {
        return [];
      }
      if (!Array.isArray(value) || !value.every(isString)) {
        throw new FieldDataError('Must be an array of strings');
      }
      return value;
    },
    validate(value) {
      const error = validateMultiRelationshipLength(validation, value);
      if (error) {
        throw new FieldDataError(error);
      }
      return value;
    },
    serialize(value) {
      return {
        value
      };
    }
  });
}

function multiselect({
  label,
  options,
  defaultValue = [],
  description
}) {
  const valuesToOption = new Map(options.map(x => [x.value, x]));
  const field = basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(MultiselectFieldInput, {
        label: label,
        description: description,
        options: options,
        ...props
      });
    },
    defaultValue() {
      return defaultValue;
    },
    parse(value) {
      if (value === undefined) {
        return [];
      }
      if (!Array.isArray(value)) {
        throw new FieldDataError('Must be an array of options');
      }
      if (!value.every(x => typeof x === 'string' && valuesToOption.has(x))) {
        throw new FieldDataError(`Must be an array with one of ${options.map(x => x.value).join(', ')}`);
      }
      return value;
    },
    validate(value) {
      return value;
    },
    serialize(value) {
      return {
        value
      };
    }
  });
  return {
    ...field,
    options
  };
}

function validateNumber(validation, value, step, label) {
  if (value !== null && typeof value !== 'number') {
    return `${label} must be a number`;
  }
  if (validation !== null && validation !== void 0 && validation.isRequired && value === null) {
    return `${label} is required`;
  }
  if (value !== null) {
    if ((validation === null || validation === void 0 ? void 0 : validation.min) !== undefined && value < validation.min) {
      return `${label} must be at least ${validation.min}`;
    }
    if ((validation === null || validation === void 0 ? void 0 : validation.max) !== undefined && value > validation.max) {
      return `${label} must be at most ${validation.max}`;
    }
    if (step !== undefined && (validation === null || validation === void 0 ? void 0 : validation.validateStep) !== undefined && !isAtStep(value, step)) {
      return `${label} must be a multiple of ${step}`;
    }
  }
}
function decimalPlaces(value) {
  const stringified = value.toString();
  const indexOfDecimal = stringified.indexOf('.');
  if (indexOfDecimal === -1) {
    const indexOfE = stringified.indexOf('e-');
    return indexOfE === -1 ? 0 : parseInt(stringified.slice(indexOfE + 2));
  }
  return stringified.length - indexOfDecimal - 1;
}
function isAtStep(value, step) {
  const dc = Math.max(decimalPlaces(step), decimalPlaces(value));
  const base = Math.pow(10, dc);
  return value * base % (step * base) === 0;
}

function number({
  label,
  defaultValue,
  step,
  validation,
  description
}) {
  return basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(NumberFieldInput, {
        label: label,
        description: description,
        validation: validation,
        step: step,
        ...props
      });
    },
    defaultValue() {
      return defaultValue !== null && defaultValue !== void 0 ? defaultValue : null;
    },
    parse(value) {
      if (value === undefined) {
        return null;
      }
      if (typeof value === 'number') {
        return value;
      }
      throw new FieldDataError('Must be a number');
    },
    validate(value) {
      const message = validateNumber(validation, value, step, label);
      if (message !== undefined) {
        throw new FieldDataError(message);
      }
      assertRequired(value, validation, label);
      return value;
    },
    serialize(value) {
      return {
        value: value === null ? undefined : value
      };
    }
  });
}

function pathReference({
  label,
  pattern,
  validation,
  description
}) {
  return basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(PathReferenceInput, {
        label: label,
        pattern: pattern,
        description: description,
        validation: validation,
        ...props
      });
    },
    defaultValue() {
      return null;
    },
    parse(value) {
      if (value === undefined) {
        return null;
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      return value;
    },
    validate(value) {
      assertRequired(value, validation, label);
      return value;
    },
    serialize(value) {
      return {
        value: value === null ? undefined : value
      };
    }
  });
}

function relationship({
  label,
  collection,
  validation,
  description
}) {
  return basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(RelationshipInput, {
        label: label,
        collection: collection,
        description: description,
        validation: validation,
        ...props
      });
    },
    defaultValue() {
      return null;
    },
    parse(value) {
      if (value === undefined) {
        return null;
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      return value;
    },
    validate(value) {
      assertRequired(value, validation, label);
      return value;
    },
    serialize(value) {
      return {
        value: value === null ? undefined : value
      };
    }
  });
}

function parseSlugFieldAsNormalField(value) {
  if (value === undefined) {
    return {
      name: '',
      slug: ''
    };
  }
  if (typeof value !== 'object') {
    throw new FieldDataError('Must be an object');
  }
  if (Object.keys(value).length !== 2) {
    throw new FieldDataError('Unexpected keys');
  }
  if (!('name' in value) || !('slug' in value)) {
    throw new FieldDataError('Missing name or slug');
  }
  if (typeof value.name !== 'string') {
    throw new FieldDataError('name must be a string');
  }
  if (typeof value.slug !== 'string') {
    throw new FieldDataError('slug must be a string');
  }
  return {
    name: value.name,
    slug: value.slug
  };
}
function parseAsSlugField(value, slug) {
  if (value === undefined) {
    return {
      name: '',
      slug
    };
  }
  if (typeof value !== 'string') {
    throw new FieldDataError('Must be a string');
  }
  return {
    name: value,
    slug
  };
}
function slug(_args) {
  var _args$name$validation, _args$name$validation2, _args$name$validation3, _args$name$validation4, _args$name$validation5, _args$slug;
  const args = {
    ..._args,
    name: {
      ..._args.name,
      validation: {
        pattern: (_args$name$validation = _args.name.validation) === null || _args$name$validation === void 0 ? void 0 : _args$name$validation.pattern,
        length: {
          min: Math.max((_args$name$validation2 = _args.name.validation) !== null && _args$name$validation2 !== void 0 && _args$name$validation2.isRequired ? 1 : 0, (_args$name$validation3 = (_args$name$validation4 = _args.name.validation) === null || _args$name$validation4 === void 0 || (_args$name$validation4 = _args$name$validation4.length) === null || _args$name$validation4 === void 0 ? void 0 : _args$name$validation4.min) !== null && _args$name$validation3 !== void 0 ? _args$name$validation3 : 0),
          max: (_args$name$validation5 = _args.name.validation) === null || _args$name$validation5 === void 0 || (_args$name$validation5 = _args$name$validation5.length) === null || _args$name$validation5 === void 0 ? void 0 : _args$name$validation5.max
        }
      }
    }
  };
  const naiveGenerateSlug = ((_args$slug = args.slug) === null || _args$slug === void 0 ? void 0 : _args$slug.generate) || slugify;
  let _defaultValue;
  function defaultValue() {
    if (!_defaultValue) {
      var _args$name$defaultVal, _args$name$defaultVal2;
      _defaultValue = {
        name: (_args$name$defaultVal = args.name.defaultValue) !== null && _args$name$defaultVal !== void 0 ? _args$name$defaultVal : '',
        slug: naiveGenerateSlug((_args$name$defaultVal2 = args.name.defaultValue) !== null && _args$name$defaultVal2 !== void 0 ? _args$name$defaultVal2 : '')
      };
    }
    return _defaultValue;
  }
  function validate(value, {
    slugField
  } = {
    slugField: undefined
  }) {
    var _args$name$validation6, _args$name$validation7, _args$name$validation8, _args$name$validation9, _args$name$validation10, _args$slug$validation, _args$slug2, _args$slug$validation2, _args$slug3, _args$slug$label, _args$slug4, _args$slug5;
    const nameMessage = validateText(value.name, (_args$name$validation6 = (_args$name$validation7 = args.name.validation) === null || _args$name$validation7 === void 0 || (_args$name$validation7 = _args$name$validation7.length) === null || _args$name$validation7 === void 0 ? void 0 : _args$name$validation7.min) !== null && _args$name$validation6 !== void 0 ? _args$name$validation6 : 0, (_args$name$validation8 = (_args$name$validation9 = args.name.validation) === null || _args$name$validation9 === void 0 || (_args$name$validation9 = _args$name$validation9.length) === null || _args$name$validation9 === void 0 ? void 0 : _args$name$validation9.max) !== null && _args$name$validation8 !== void 0 ? _args$name$validation8 : Infinity, args.name.label, undefined, (_args$name$validation10 = args.name.validation) === null || _args$name$validation10 === void 0 ? void 0 : _args$name$validation10.pattern);
    if (nameMessage !== undefined) {
      throw new FieldDataError(nameMessage);
    }
    const slugMessage = validateText(value.slug, (_args$slug$validation = (_args$slug2 = args.slug) === null || _args$slug2 === void 0 || (_args$slug2 = _args$slug2.validation) === null || _args$slug2 === void 0 || (_args$slug2 = _args$slug2.length) === null || _args$slug2 === void 0 ? void 0 : _args$slug2.min) !== null && _args$slug$validation !== void 0 ? _args$slug$validation : 1, (_args$slug$validation2 = (_args$slug3 = args.slug) === null || _args$slug3 === void 0 || (_args$slug3 = _args$slug3.validation) === null || _args$slug3 === void 0 || (_args$slug3 = _args$slug3.length) === null || _args$slug3 === void 0 ? void 0 : _args$slug3.max) !== null && _args$slug$validation2 !== void 0 ? _args$slug$validation2 : Infinity, (_args$slug$label = (_args$slug4 = args.slug) === null || _args$slug4 === void 0 ? void 0 : _args$slug4.label) !== null && _args$slug$label !== void 0 ? _args$slug$label : 'Slug', slugField ? slugField : {
      slugs: emptySet,
      glob: '*'
    }, (_args$slug5 = args.slug) === null || _args$slug5 === void 0 || (_args$slug5 = _args$slug5.validation) === null || _args$slug5 === void 0 ? void 0 : _args$slug5.pattern);
    if (slugMessage !== undefined) {
      throw new FieldDataError(slugMessage);
    }
    return value;
  }
  const emptySet = new Set();
  return {
    kind: 'form',
    formKind: 'slug',
    label: args.name.label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(SlugFieldInput, {
        args: args,
        naiveGenerateSlug: naiveGenerateSlug,
        defaultValue: defaultValue(),
        ...props
      });
    },
    defaultValue,
    parse(value, args) {
      if ((args === null || args === void 0 ? void 0 : args.slug) !== undefined) {
        return parseAsSlugField(value, args.slug);
      }
      return parseSlugFieldAsNormalField(value);
    },
    validate,
    serialize(value) {
      return {
        value
      };
    },
    serializeWithSlug(value) {
      return {
        value: value.name,
        slug: value.slug
      };
    },
    reader: {
      parse(value) {
        const parsed = parseSlugFieldAsNormalField(value);
        return validate(parsed);
      },
      parseWithSlug(value, args) {
        return validate(parseAsSlugField(value, args.slug), {
          slugField: {
            glob: args.glob,
            slugs: emptySet
          }
        }).name;
      }
    }
  };
}

function isValidURL(url) {
  return url === dist.sanitizeUrl(url);
}

function validateUrl(validation, value, label) {
  if (value !== null && (typeof value !== 'string' || !isValidURL(value))) {
    return `${label} is not a valid URL`;
  }
  if (validation !== null && validation !== void 0 && validation.isRequired && value === null) {
    return `${label} is required`;
  }
}

function url({
  label,
  defaultValue,
  validation,
  description
}) {
  return basicFormFieldWithSimpleReaderParse({
    label,
    Input(props) {
      return /*#__PURE__*/jsxRuntimeExports.jsx(UrlFieldInput, {
        label: label,
        description: description,
        validation: validation,
        ...props
      });
    },
    defaultValue() {
      return defaultValue || null;
    },
    parse(value) {
      if (value === undefined) {
        return null;
      }
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      return value === '' ? null : value;
    },
    validate(value) {
      const message = validateUrl(validation, value, label);
      if (message !== undefined) {
        throw new FieldDataError(message);
      }
      assertRequired(value, validation, label);
      return value;
    },
    serialize(value) {
      return {
        value: value === null ? undefined : value
      };
    }
  });
}

function ignored() {
  return {
    kind: 'form',
    Input() {
      return null;
    },
    defaultValue() {
      return {
        value: undefined
      };
    },
    parse(value) {
      return {
        value
      };
    },
    serialize(value) {
      return value;
    },
    validate(value) {
      return value;
    },
    label: 'Ignored',
    reader: {
      parse(value) {
        return value;
      }
    }
  };
}

var index = /*#__PURE__*/Object.freeze({
  __proto__: null,
  array: array,
  blocks: blocks,
  checkbox: checkbox,
  child: child,
  cloudImage: cloudImage,
  conditional: conditional,
  date: date,
  datetime: datetime,
  document: document,
  empty: empty,
  emptyDocument: emptyDocument,
  emptyContent: emptyContent,
  file: file,
  image: image,
  integer: integer,
  multiRelationship: multiRelationship,
  multiselect: multiselect,
  number: number,
  object: object,
  pathReference: pathReference,
  relationship: relationship,
  select: select,
  slug: slug,
  text: text,
  url: url,
  ignored: ignored,
  mdx: mdx,
  markdoc: markdoc
});

const repo = "malipetek/malipetek.github.io";
const imageOptions = {
  directory: "public/blog-images",
  publicPath: "/blog-images/"
};
const blogCategoryOptions = [
  { label: "Linux", value: "linux" },
  { label: "Shopify", value: "shopify" },
  { label: "Svelte", value: "svelte" },
  { label: "Web", value: "web" }
];
function blogPostCollection() {
  return collection({
    label: "Blog Posts",
    path: "src/content/blog/*",
    slugField: "title",
    entryLayout: "content",
    columns: ["title", "category", "description"],
    format: {
      contentField: "content"
    },
    schema: {
      title: index.slug({
        name: {
          label: "Title",
          validation: { isRequired: true }
        }
      }),
      category: index.select({
        label: "Category",
        options: blogCategoryOptions,
        defaultValue: "linux"
      }),
      description: index.text({
        label: "Description",
        multiline: true,
        description: "Short SEO/listing description."
      }),
      summary: index.text({
        label: "Summary",
        multiline: true
      }),
      keywords: index.text({
        label: "Keywords",
        description: "Comma-separated keywords."
      }),
      image: index.text({
        label: "Image URL"
      }),
      content: index.markdoc({
        label: "Content",
        extension: "md",
        options: {
          bold: true,
          italic: true,
          strikethrough: true,
          code: true,
          heading: true,
          blockquote: true,
          orderedList: true,
          unorderedList: true,
          table: true,
          link: true,
          image: imageOptions,
          divider: true,
          codeBlock: true
        }
      })
    }
  });
}
const config = config$1({
  storage: {
    kind: "github",
    repo
  },
  ui: {
    brand: {
      name: "malipetek.dev"
    },
    navigation: {
      Blog: ["blogPosts"]
    }
  },
  collections: {
    blogPosts: blogPostCollection()
  }
});

const all = makeHandler({ config });
const ALL = all;

const prerender = false;

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    ALL,
    all,
    prerender
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };

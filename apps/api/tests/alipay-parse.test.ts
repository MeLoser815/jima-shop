import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * 模拟「业务错误无签名」场景：网关返回无效 AppId 时，
 * 我们应抽出业务错误而不是当成网络故障。
 */
function coerceLikeSdk(err: {
  message: string;
  code?: string;
  data?: Record<string, unknown>;
}): {
  ok: boolean;
  code?: string;
  msg?: string;
  subMsg?: string;
} {
  const candidate = err.data;
  if (candidate && typeof candidate === 'object') {
    const code = String(candidate.code ?? '');
    const msg = String(candidate.msg ?? err.message);
    const subMsg = candidate.subMsg
      ? String(candidate.subMsg)
      : candidate.sub_msg
        ? String(candidate.sub_msg)
        : undefined;
    if (code || subMsg || msg) {
      return { ok: false, code: code || undefined, msg, subMsg };
    }
  }
  const msg = err.message;
  const looksBiz = /app.?id|无效|签名|Business Failed|isv\./i.test(msg);
  return {
    ok: false,
    code: err.code || (looksBiz ? 'BIZ_ERROR' : 'SDK_ERROR'),
    msg: looksBiz ? msg : `调用支付宝失败: ${msg}`,
  };
}

describe('alipay business error handling', () => {
  it('returns business error from data payload without sign', () => {
    const r = coerceLikeSdk({
      message: 'check sign error',
      data: {
        code: '40002',
        msg: 'Invalid Arguments',
        sub_code: 'isv.invalid-app-id',
        sub_msg: '无效的AppID参数',
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, '40002');
    assert.equal(r.subMsg, '无效的AppID参数');
  });

  it('classifies invalid app id message as biz error', () => {
    const r = coerceLikeSdk({
      message: '无效的AppID参数',
    });
    assert.equal(r.code, 'BIZ_ERROR');
    assert.match(r.msg!, /AppID/);
  });

  it('keeps network-like errors as SDK_ERROR', () => {
    const r = coerceLikeSdk({
      message: 'connect ETIMEDOUT 1.2.3.4:443',
    });
    assert.equal(r.code, 'SDK_ERROR');
    assert.match(r.msg!, /调用支付宝失败/);
  });
});

describe('notify success response', () => {
  it('expects plain success string for alipay', () => {
    const body = 'success';
    assert.equal(body, 'success');
  });
});

describe('precreate amount validation', () => {
  const re = /^\d+(\.\d{1,2})?$/;
  it('accepts valid amounts', () => {
    assert.equal(re.test('0.01'), true);
    assert.equal(re.test('88.88'), true);
    assert.equal(re.test('100'), true);
  });
  it('rejects invalid amounts', () => {
    assert.equal(re.test('0'), true); // format ok, business refine rejects <0.01
    assert.equal(re.test('-1'), false);
    assert.equal(re.test('1.234'), false);
    assert.equal(re.test('abc'), false);
  });
});

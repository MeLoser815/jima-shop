import { useEffect, useRef, useState } from 'react';
import { App, Button, Card, Input, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api, type PublicOrder } from '../../api';
import DeliveredKeys from '../../components/DeliveredKeys';

function unpaidLabel(status?: string) {
  if (status === 'WAIT_BUYER_PAY' || status === 'PAYING') return '待付款';
  if (status === 'TRADE_CLOSED') return '已关闭';
  if (status === 'FAILED') return '支付失败';
  return status || '未支付';
}

export default function OrderQuery() {
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const initial = (params.get('no') || '').trim();
  const [no, setNo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const pollingNo = useRef('');

  function isTerminalStatus(status?: string, paid?: boolean) {
    if (paid) return true;
    return status === 'TRADE_CLOSED' || status === 'FAILED';
  }

  async function lookup(outTradeNo: string) {
    const q = outTradeNo.trim();
    if (!q) {
      message.warning('请输入商户单号');
      return;
    }
    setBusy(true);
    pollingNo.current = q;
    try {
      const res = await api.queryOrder(q);
      setOrder(res.order);
      setParams(q ? { no: q } : {}, { replace: true });
    } catch (e) {
      setOrder(null);
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initial) lookup(initial);
    // 仅首次按地址栏单号查询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const currentNo = order?.outTradeNo;
    if (!currentNo || isTerminalStatus(order.status, order.paid)) return;
    const t = setInterval(async () => {
      if (pollingNo.current !== currentNo) return;
      try {
        const res = await api.queryOrder(currentNo);
        if (pollingNo.current !== currentNo) return;
        setOrder(res.order);
      } catch {
        /* 轮询失败时保留上次结果，下一轮继续 */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [order?.outTradeNo, order?.status, order?.paid]);

  const paid = order?.paid;
  const pending = order?.fulfillmentStatus === 'pending_fulfillment';

  return (
    <div className="query-page">
      <Card className="glass-card">
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          订单查询
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          输入支付时显示的商户单号，已支付订单可查看发放的卡密。无需登录。
        </Typography.Paragraph>
        <Space.Compact className="query-form" style={{ width: '100%', maxWidth: 520, display: 'flex', margin: '0 auto 20px' }}>
          <Input
            size="large"
            placeholder="商户单号，例如 JM2026…"
            value={no}
            allowClear
            onChange={(e) => setNo(e.target.value)}
            onPressEnter={() => lookup(no)}
          />
          <Button
            type="primary"
            size="large"
            className="candy-btn"
            icon={<SearchOutlined />}
            loading={busy}
            onClick={() => lookup(no)}
          >
            查单
          </Button>
        </Space.Compact>

        {order && (
          <div>
            <Typography.Paragraph style={{ textAlign: 'center' }}>
              {order.subject} · ¥{order.totalAmount}
              <br />
              <span className="mono">{order.outTradeNo}</span>
              <br />
              状态：
              {paid ? (pending ? '已支付，待补发卡密' : '已支付') : unpaidLabel(order.status)}
              {order.payMethod ? ` · ${order.payMethod}` : ''}
            </Typography.Paragraph>
            {!paid && order.usdt?.address && (
              <Typography.Paragraph style={{ textAlign: 'center' }}>
                请务必在「{order.usdt.network || '对应网络'}」向该地址转入精确的 {order.usdt.amount} USDT，转错链无法到账
                <br />
                <span className="mono">{order.usdt.address}</span>
                {order.usdt.expireAt ? (
                  <>
                    <br />
                    请在 {new Date(order.usdt.expireAt).toLocaleString()} 前完成转账
                  </>
                ) : null}
              </Typography.Paragraph>
            )}
            {!paid && !pending && order.status !== 'TRADE_CLOSED' && order.status !== 'FAILED' && (
              <Typography.Paragraph type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
                正在自动查询支付结果，到账确认可能需要几分钟，请稍候或稍后刷新。
              </Typography.Paragraph>
            )}
            {paid ? (
              <DeliveredKeys
                keys={order.keys}
                pending={pending}
                messageText={order.message}
              />
            ) : (
              <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
                订单尚未支付，支付成功后可在此查看卡密。
              </Typography.Paragraph>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { App, Button, Card, Input, Space, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api, type PublicOrder } from '../../api';
import DeliveredKeys from '../../components/DeliveredKeys';

export default function OrderQuery() {
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const initial = (params.get('no') || '').trim();
  const [no, setNo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<PublicOrder | null>(null);

  async function lookup(outTradeNo: string) {
    const q = outTradeNo.trim();
    if (!q) {
      message.warning('请输入商户单号');
      return;
    }
    setBusy(true);
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
              {paid ? (pending ? '已支付，待补发卡密' : '已支付') : order.status || '未支付'}
            </Typography.Paragraph>
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

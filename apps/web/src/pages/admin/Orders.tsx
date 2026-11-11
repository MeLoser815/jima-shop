import { useEffect, useState } from 'react';
import { App, Button, Table, Tag, Typography } from 'antd';
import { api, type DeliveredKey } from '../../api';

type Row = {
  id: number;
  out_trade_no: string;
  total_amount: string;
  subject: string;
  status: string;
  created_at: string;
  trade_no: string | null;
  buyer_note: string | null;
  fulfillment_status?: string;
  items: Array<{
    product_name: string;
    unit_price: string;
    quantity: number;
  }>;
  keys?: DeliveredKey[];
};

function statusTag(s: string) {
  if (s === 'TRADE_SUCCESS' || s === 'TRADE_FINISHED' || s === 'SUCCESS') {
    return <Tag color="success">{s}</Tag>;
  }
  if (s === 'WAIT_BUYER_PAY' || s === 'PAYING') {
    return <Tag color="processing">{s}</Tag>;
  }
  if (s === 'FAILED') return <Tag color="error">{s}</Tag>;
  return <Tag>{s}</Tag>;
}

function fulfillmentTag(s?: string) {
  if (s === 'pending_fulfillment') return <Tag color="warning">待补发</Tag>;
  if (s === 'delivered') return <Tag color="success">已发货</Tag>;
  if (s === 'none') return <Tag>无需发卡</Tag>;
  return <Tag>—</Tag>;
}

export default function Orders() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [fulfilling, setFulfilling] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .listOrders()
      .then((r) => setRows(r.orders as Row[]))
      .catch((e) => message.error((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  async function fulfill(outTradeNo: string) {
    setFulfilling(outTradeNo);
    try {
      const res = await api.fulfillOrder(outTradeNo);
      if (res.fulfillmentStatus === 'delivered') {
        message.success(res.added > 0 ? `已补发 ${res.added} 张卡密` : '该订单已发齐');
      } else {
        message.warning(
          res.added > 0
            ? `已补发 ${res.added} 张，仍有缺口，请继续补货后再试`
            : '货源仍不足，请先补充未用卡密后再补发',
        );
      }
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setFulfilling(null);
    }
  }

  return (
    <div>
      <Typography.Title level={3}>订单列表</Typography.Title>
      <Typography.Paragraph type="secondary">
        含购物车结账与收银台当面付订单。支付成功后会自动发放预占卡密；若当时库存不足会标记为「待补发」，补货后可在此点击「补发」。
      </Typography.Paragraph>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1100 }}
        expandable={{
          expandedRowRender: (r) => (
            <div>
              {r.items?.length ? (
                <ul style={{ margin: '0 0 12px' }}>
                  {r.items.map((it, i) => (
                    <li key={i}>
                      {it.product_name} × {it.quantity}（¥{it.unit_price}）
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ color: '#999', marginBottom: 12 }}>
                  无明细（可能来自收银台直接收款）
                </div>
              )}
              {r.buyer_note ? (
                <div style={{ marginBottom: 8 }}>买家备注：{r.buyer_note}</div>
              ) : null}
              {r.keys?.length ? (
                <div>
                  <Typography.Text strong>已发放卡密</Typography.Text>
                  <ul style={{ margin: '8px 0 0' }}>
                    {r.keys.map((k) => (
                      <li key={k.id} className="mono">
                        {k.productName} · {k.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : r.fulfillment_status === 'pending_fulfillment' ? (
                <div>
                  <Typography.Text type="warning">
                    待补发：支付已成功，但当时卡密不足。请先在商品管理补充货源，再点击「补发」。补发前买家查单不会自动完成。
                  </Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <Button
                      type="primary"
                      size="small"
                      loading={fulfilling === r.out_trade_no}
                      onClick={() => fulfill(r.out_trade_no)}
                    >
                      补发
                    </Button>
                  </div>
                </div>
              ) : (
                <span style={{ color: '#999' }}>暂无发放记录</span>
              )}
            </div>
          ),
        }}
        columns={[
          { title: '商户单号', dataIndex: 'out_trade_no', width: 220 },
          { title: '标题', dataIndex: 'subject' },
          {
            title: '金额',
            dataIndex: 'total_amount',
            width: 100,
            render: (v: string) => <span className="price">¥{v}</span>,
          },
          {
            title: '支付状态',
            dataIndex: 'status',
            width: 150,
            render: statusTag,
          },
          {
            title: '发货',
            dataIndex: 'fulfillment_status',
            width: 110,
            render: fulfillmentTag,
          },
          { title: '支付宝单号', dataIndex: 'trade_no', width: 180 },
          { title: '时间', dataIndex: 'created_at', width: 170 },
          {
            title: '操作',
            width: 100,
            render: (_: unknown, r: Row) =>
              r.fulfillment_status === 'pending_fulfillment' ? (
                <Button
                  type="link"
                  size="small"
                  loading={fulfilling === r.out_trade_no}
                  onClick={() => fulfill(r.out_trade_no)}
                >
                  补发
                </Button>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}

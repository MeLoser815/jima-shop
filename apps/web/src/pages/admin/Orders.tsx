import { useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { useSearchParams } from 'react-router-dom';
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

type PayStatus = 'all' | 'paid' | 'pending' | 'closed';
type Fulfillment = 'all' | 'pending_fulfillment' | 'delivered' | 'none';
type SortBy = 'created_at' | 'total_amount' | 'status' | 'subject' | 'id';

const PAGE_SIZES = [15, 30, 50, 100];

const PAID = new Set(['TRADE_SUCCESS', 'TRADE_FINISHED', 'SUCCESS']);
const PENDING = new Set(['WAIT_BUYER_PAY', 'PAYING']);
const CLOSED = new Set(['TRADE_CLOSED', 'FAILED']);

function payStatusLabel(s: string) {
  if (PAID.has(s)) return '已支付';
  if (PENDING.has(s)) return '待付款';
  if (s === 'TRADE_CLOSED') return '已关闭';
  if (s === 'FAILED') return '支付失败';
  return s || '未知';
}

function statusTag(s: string) {
  if (PAID.has(s)) return <Tag color="success">{payStatusLabel(s)}</Tag>;
  if (PENDING.has(s)) return <Tag color="processing">{payStatusLabel(s)}</Tag>;
  if (CLOSED.has(s)) return <Tag color="error">{payStatusLabel(s)}</Tag>;
  return <Tag>{payStatusLabel(s)}</Tag>;
}

function fulfillmentTag(s?: string) {
  if (s === 'pending_fulfillment') return <Tag color="warning">待补发</Tag>;
  if (s === 'delivered') return <Tag color="success">已发货</Tag>;
  if (s === 'none') return <Tag>无需发卡</Tag>;
  return <Tag>—</Tag>;
}

function parseFulfillment(raw: string | null): Fulfillment {
  if (
    raw === 'pending_fulfillment' ||
    raw === 'delivered' ||
    raw === 'none'
  ) {
    return raw;
  }
  return 'all';
}

export default function Orders() {
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [fulfilling, setFulfilling] = useState<string | null>(null);
  const [keyword, setKeyword] = useState(params.get('q') || '');
  const [appliedKeyword, setAppliedKeyword] = useState(params.get('q') || '');
  const [payStatus, setPayStatus] = useState<PayStatus>(() => {
    const raw = params.get('payStatus');
    return raw === 'paid' || raw === 'pending' || raw === 'closed' ? raw : 'all';
  });
  const [fulfillment, setFulfillment] = useState<Fulfillment>(
    parseFulfillment(params.get('fulfillment')),
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  function load() {
    setLoading(true);
    api
      .listOrders({
        q: appliedKeyword.trim() || undefined,
        payStatus,
        fulfillment,
        sortBy,
        sortOrder,
        page,
        pageSize,
      })
      .then((r) => {
        setRows(r.orders as Row[]);
        setTotal(r.total ?? r.orders.length);
      })
      .catch((e) => message.error((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKeyword, payStatus, fulfillment, page, pageSize, sortBy, sortOrder, message]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (appliedKeyword.trim()) next.set('q', appliedKeyword.trim());
    if (payStatus !== 'all') next.set('payStatus', payStatus);
    if (fulfillment !== 'all') next.set('fulfillment', fulfillment);
    setParams(next, { replace: true });
  }, [appliedKeyword, payStatus, fulfillment, setParams]);

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

  const hasFilters =
    appliedKeyword.trim() !== '' || payStatus !== 'all' || fulfillment !== 'all';

  function resetFilters() {
    setKeyword('');
    setAppliedKeyword('');
    setPayStatus('all');
    setFulfillment('all');
    setPage(1);
  }

  const columns: TableProps<Row>['columns'] = useMemo(
    () => [
      {
        title: '商户单号',
        dataIndex: 'out_trade_no',
        width: 220,
        render: (v: string) => <span className="mono">{v}</span>,
      },
      {
        title: '标题',
        dataIndex: 'subject',
        sorter: true,
        sortOrder: sortBy === 'subject' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      },
      {
        title: '金额',
        dataIndex: 'total_amount',
        width: 110,
        sorter: true,
        sortOrder:
          sortBy === 'total_amount' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
        render: (v: string) => <span className="price">¥{v}</span>,
      },
      {
        title: '支付状态',
        dataIndex: 'status',
        width: 120,
        sorter: true,
        sortOrder: sortBy === 'status' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
        render: statusTag,
      },
      {
        title: '发货',
        dataIndex: 'fulfillment_status',
        width: 110,
        render: fulfillmentTag,
      },
      {
        title: '支付宝单号',
        dataIndex: 'trade_no',
        width: 180,
        render: (v: string | null) => v || '—',
      },
      {
        title: '时间',
        dataIndex: 'created_at',
        width: 170,
        sorter: true,
        defaultSortOrder: 'descend',
        sortOrder:
          sortBy === 'created_at' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      },
      {
        title: '操作',
        width: 110,
        fixed: 'right',
        render: (_: unknown, r: Row) =>
          r.fulfillment_status === 'pending_fulfillment' ? (
            <Button
              type="primary"
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
    ],
    [sortBy, sortOrder, fulfilling],
  );

  return (
    <div>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>
        订单列表
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        含购物车结账与收银台当面付订单。支付成功后会自动发放预占卡密；若当时库存不足会标记为「待补发」，补货后可在此点击「补发」。
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="搜索商户单号、支付宝单号或标题"
          style={{ width: 280 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={(v) => {
            setAppliedKeyword(v);
            setPage(1);
          }}
        />
        <Select
          value={payStatus}
          style={{ width: 140 }}
          options={[
            { value: 'all', label: '全部支付状态' },
            { value: 'paid', label: '已支付' },
            { value: 'pending', label: '待付款' },
            { value: 'closed', label: '已关闭/失败' },
          ]}
          onChange={(v) => {
            setPayStatus(v);
            setPage(1);
          }}
        />
        <Select
          value={fulfillment}
          style={{ width: 140 }}
          options={[
            { value: 'all', label: '全部发货状态' },
            { value: 'pending_fulfillment', label: '待补发' },
            { value: 'delivered', label: '已发货' },
            { value: 'none', label: '无需发卡' },
          ]}
          onChange={(v) => {
            setFulfillment(v);
            setPage(1);
          }}
        />
        {hasFilters ? <Button onClick={resetFilters}>重置筛选</Button> : null}
      </Space>

      <Table<Row>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={columns}
        scroll={{ x: 1200 }}
        locale={{ emptyText: hasFilters ? '没有符合条件的订单' : '暂无订单' }}
        onChange={(_pag, _filters, sorter) => {
          const s = Array.isArray(sorter) ? sorter[0] : sorter;
          const field = s?.field;
          if (s?.order && (field === 'created_at' || field === 'total_amount' || field === 'status' || field === 'subject')) {
            setSortBy(field);
            setSortOrder(s.order === 'ascend' ? 'asc' : 'desc');
            setPage(1);
          } else {
            setSortBy('created_at');
            setSortOrder('desc');
            setPage(1);
          }
        }}
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
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES.map(String),
          showTotal: (t) => `共 ${t} 笔`,
          onChange: (p, ps) => {
            setPage(ps !== pageSize ? 1 : p);
            setPageSize(ps);
          },
        }}
      />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { App, Select, Space, Table, Typography } from 'antd';
import { api } from '../../api';

type LogRow = {
  id: number;
  actor: string;
  action: string;
  detail: string | null;
  ip: string | null;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  'admin.setup': '首次创建管理员',
  'admin.login': '登录成功',
  'admin.login_failed': '登录失败',
  'admin.logout': '退出登录',
  'admin.change_password': '修改密码',
  'admin.change_path': '修改后台路径',
  'settings.update': '更新支付宝设置',
  'keys.import': '导入卡密',
  'order.fulfill': '订单补发',
};

const PAGE_SIZES = [15, 30, 50, 100];
const RETENTION_OPTIONS = [7, 30, 90, 180];

export default function Audit() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [total, setTotal] = useState(0);
  const [retentionDays, setRetentionDays] = useState(30);
  const [savingRetention, setSavingRetention] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listAudit(page, pageSize)
      .then((r) => {
        if (cancelled) return;
        setRows(r.logs);
        setTotal(r.total);
        setRetentionDays(r.retentionDays);
      })
      .catch((e) => {
        if (!cancelled) message.error((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, message]);

  async function onRetentionChange(days: number) {
    setSavingRetention(true);
    try {
      const res = await api.updateAuditRetention(days);
      setRetentionDays(res.retentionDays);
      message.success(`操作日志将保留 ${res.retentionDays} 天，过期后自动清理`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSavingRetention(false);
    }
  }

  return (
    <div>
      <Typography.Title level={3}>操作日志</Typography.Title>
      <Space
        align="start"
        style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}
        wrap
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          记录登录、改密、收款设置、卡密导入与补发。日志不含密码、密钥和卡密明文。过期记录会自动删除，以减轻 SQLite
          压力。
        </Typography.Paragraph>
        <Space>
          <Typography.Text type="secondary">保留时间</Typography.Text>
          <Select
            style={{ width: 120 }}
            value={retentionDays}
            loading={savingRetention}
            options={RETENTION_OPTIONS.map((d) => ({
              value: d,
              label: `${d} 天`,
            }))}
            onChange={(v) => void onRetentionChange(v)}
          />
        </Space>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES.map(String),
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(ps !== pageSize ? 1 : p);
            setPageSize(ps);
          },
        }}
        columns={[
          { title: '时间', dataIndex: 'created_at', width: 180 },
          { title: '操作者', dataIndex: 'actor', width: 140 },
          {
            title: '动作',
            dataIndex: 'action',
            width: 160,
            render: (v: string) => ACTION_LABEL[v] || v,
          },
          {
            title: '详情',
            dataIndex: 'detail',
            ellipsis: true,
            render: (v: string | null) => v || '—',
          },
          { title: 'IP', dataIndex: 'ip', width: 140, render: (v: string | null) => v || '—' },
        ]}
      />
    </div>
  );
}

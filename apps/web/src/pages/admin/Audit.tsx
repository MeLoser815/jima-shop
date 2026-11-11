import { useEffect, useState } from 'react';
import { App, Table, Typography } from 'antd';
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
  'settings.update': '更新支付宝设置',
  'keys.import': '导入卡密',
  'order.fulfill': '订单补发',
};

export default function Audit() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .listAudit(200)
      .then((r) => setRows(r.logs))
      .catch((e) => message.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [message]);

  return (
    <div>
      <Typography.Title level={3}>操作日志</Typography.Title>
      <Typography.Paragraph type="secondary">
        记录登录、改密、收款设置、卡密导入与补发。日志不含密码、密钥和卡密明文。
      </Typography.Paragraph>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 900 }}
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

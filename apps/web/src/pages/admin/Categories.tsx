import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api, type Category } from '../../api';

type Row = Category & {
  status: 'on' | 'off';
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

type FormVals = {
  name: string;
  slug: string;
  icon?: string;
  sortOrder: number;
  status: 'on' | 'off';
};

const PAGE_SIZES = [15, 30, 50, 100];

function defaultCategoryOrder(a: Row, b: Row) {
  return a.sort_order - b.sort_order || a.id - b.id;
}

export default function Categories() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm<FormVals>();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'on' | 'off'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.listAdminCategories('all');
      setRows(res.categories as Row[]);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredRows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return rows
      .filter((c) => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        if (
          q &&
          !c.name.toLowerCase().includes(q) &&
          !c.slug.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .slice()
      .sort(defaultCategoryOrder);
  }, [rows, keyword, statusFilter]);

  const hasFilters = keyword.trim() !== '' || statusFilter !== 'all';

  function resetFilters() {
    setKeyword('');
    setStatusFilter('all');
    setPage(1);
  }

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      icon: '🎁',
      sortOrder: 0,
      status: 'on',
    });
    setOpen(true);
  }

  function openEdit(c: Row) {
    setEditing(c);
    form.setFieldsValue({
      name: c.name,
      slug: c.slug,
      icon: c.icon,
      sortOrder: c.sort_order,
      status: c.status,
    });
    setOpen(true);
  }

  async function toggleStatus(c: Row) {
    const next = c.status === 'on' ? 'off' : 'on';
    setTogglingId(c.id);
    try {
      const res = await api.updateCategory(c.id, { status: next });
      setRows((prev) =>
        prev.map((row) =>
          row.id === c.id ? { ...row, ...(res.category as Row), status: next } : row,
        ),
      );
      message.success(next === 'on' ? '已启用该分类' : '已停用，前台不再展示该分类');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setTogglingId(null);
    }
  }

  async function submit() {
    const v = await form.validateFields();
    try {
      if (editing) {
        await api.updateCategory(editing.id, {
          name: v.name,
          slug: v.slug,
          icon: v.icon || '🎁',
          sortOrder: v.sortOrder,
          status: v.status,
        });
        message.success('已更新分类');
      } else {
        await api.createCategory({
          name: v.name,
          slug: v.slug,
          icon: v.icon || '🎁',
          sortOrder: v.sortOrder,
          status: v.status,
        });
        message.success('已创建分类');
      }
      setOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  const columns: TableProps<Row>['columns'] = [
    {
      title: '图标',
      dataIndex: 'icon',
      width: 70,
      render: (v: string) => <span style={{ fontSize: 22 }}>{v}</span>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name, 'zh-CN'),
    },
    {
      title: 'Slug',
      dataIndex: 'slug',
      width: 140,
      sorter: (a, b) => a.slug.localeCompare(b.slug),
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 90,
      defaultSortOrder: 'ascend',
      sorter: defaultCategoryOrder,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      sorter: (a, b) => Number(b.status === 'on') - Number(a.status === 'on'),
      render: (_, c) => (
        <Switch
          checked={c.status === 'on'}
          checkedChildren="启用"
          unCheckedChildren="停用"
          loading={togglingId === c.id}
          onChange={() => void toggleStatus(c)}
        />
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 180,
      sorter: (a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''),
      render: (v: string | undefined) => v || '—',
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (_, c) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openEdit(c)}>
            编辑
          </Button>
          <Popconfirm
            title="删除后商品将解除该分类关联，确认？"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={async () => {
              try {
                await api.deleteCategory(c.id);
                message.success('已删除');
                load();
              } catch (e) {
                message.error((e as Error).message);
              }
            }}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space
        style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}
        wrap
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            商品分类
          </Typography.Title>
          <Typography.Text type="secondary">
            前台可按分类筛选；商品需归属分类。用开关即可启用或停用。
          </Typography.Text>
        </div>
        <Button
          type="primary"
          className="candy-btn"
          icon={<PlusOutlined />}
          onClick={openCreate}
        >
          新增分类
        </Button>
      </Space>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="搜索分类名称或 Slug"
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={statusFilter}
          style={{ width: 140 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'on', label: '已启用' },
            { value: 'off', label: '已停用' },
          ]}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        />
        {hasFilters ? <Button onClick={resetFilters}>重置筛选</Button> : null}
      </Space>

      <Table<Row>
        rowKey="id"
        loading={loading}
        dataSource={filteredRows}
        columns={columns}
        scroll={{ x: 900 }}
        locale={{ emptyText: hasFilters ? '没有符合条件的分类' : '暂无分类' }}
        pagination={{
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES.map(String),
          showTotal: (t) => `共 ${t} 个`,
          onChange: (p, ps) => {
            setPage(ps !== pageSize ? 1 : p);
            setPageSize(ps);
          },
        }}
      />

      <Modal
        title={editing ? '编辑分类' : '新增分类'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input maxLength={64} placeholder="例如 居家治愈" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="Slug"
            rules={[
              { required: true },
              {
                pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
                message: '仅小写字母、数字与中划线',
              },
            ]}
          >
            <Input maxLength={64} placeholder="home" />
          </Form.Item>
          <Form.Item name="icon" label="图标（emoji）">
            <Input maxLength={8} placeholder="🏠" />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="sortOrder" label="排序">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              name="status"
              label="启用"
              valuePropName="checked"
              getValueFromEvent={(c) => (c ? 'on' : 'off')}
              getValueProps={(v) => ({ checked: v === 'on' })}
            >
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}

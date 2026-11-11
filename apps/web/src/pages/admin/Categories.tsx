import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api, type Category } from '../../api';

type Row = Category & { status: 'on' | 'off'; sort_order: number };

type FormVals = {
  name: string;
  slug: string;
  icon?: string;
  sortOrder: number;
  status: 'on' | 'off';
};

export default function Categories() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm<FormVals>();

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
            前台可按分类筛选；商品需归属分类
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

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 720 }}
        columns={[
          {
            title: '图标',
            dataIndex: 'icon',
            width: 70,
            render: (v: string) => <span style={{ fontSize: 22 }}>{v}</span>,
          },
          { title: '名称', dataIndex: 'name' },
          { title: 'Slug', dataIndex: 'slug', width: 140 },
          { title: '排序', dataIndex: 'sort_order', width: 80 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (s: string) =>
              s === 'on' ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
          },
          {
            title: '操作',
            width: 180,
            render: (_, c) => (
              <Space>
                <Button type="link" onClick={() => openEdit(c)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除后商品将解除该分类关联，确认？"
                  onConfirm={async () => {
                    await api.deleteCategory(c.id);
                    message.success('已删除');
                    load();
                  }}
                >
                  <Button type="link" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
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

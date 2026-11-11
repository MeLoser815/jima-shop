import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { KeyOutlined, PlusOutlined } from '@ant-design/icons';
import {
  api,
  type AdminCardKey,
  type AdminProduct,
  type Category,
} from '../../api';

type FormVals = {
  name: string;
  description?: string;
  price: string;
  coverUrl?: string;
  status: 'on' | 'off';
  sortOrder: number;
  categoryId?: number | null;
};

export default function Products() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [form] = Form.useForm<FormVals>();

  const [keysOpen, setKeysOpen] = useState(false);
  const [keysProduct, setKeysProduct] = useState<AdminProduct | null>(null);
  const [keys, setKeys] = useState<AdminCardKey[]>([]);
  const [unusedCount, setUnusedCount] = useState(0);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keyFilter, setKeyFilter] = useState<'all' | 'unused' | 'sold'>('all');
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [res, cats] = await Promise.all([
        api.listAdminProducts('all'),
        api.listAdminCategories('all'),
      ]);
      setRows(res.products);
      setCategories(cats.categories);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const catName = (id: number | null) => {
    if (!id) return '—';
    return categories.find((c) => c.id === id)?.name || `#${id}`;
  };

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      status: 'on',
      sortOrder: 0,
      price: '9.90',
      categoryId: categories[0]?.id ?? null,
    });
    setOpen(true);
  }

  function openEdit(p: AdminProduct) {
    setEditing(p);
    form.setFieldsValue({
      name: p.name,
      description: p.description,
      price: p.price,
      coverUrl: p.cover_url,
      status: p.status,
      sortOrder: p.sort_order,
      categoryId: p.category_id,
    });
    setOpen(true);
  }

  async function loadKeys(product: AdminProduct, status = keyFilter) {
    setKeysLoading(true);
    try {
      const res = await api.listProductKeys(product.id, status);
      setKeys(res.keys);
      setUnusedCount(res.unusedCount);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setKeysLoading(false);
    }
  }

  function openKeys(p: AdminProduct) {
    setKeysProduct(p);
    setImportText('');
    setKeyFilter('all');
    setKeysOpen(true);
    loadKeys(p, 'all');
  }

  async function submit() {
    const v = await form.validateFields();
    try {
      if (editing) {
        await api.updateProduct(editing.id, {
          name: v.name,
          description: v.description || '',
          price: String(v.price),
          coverUrl: v.coverUrl || '',
          status: v.status,
          sortOrder: v.sortOrder,
          categoryId: v.categoryId ?? null,
        });
        message.success('已更新');
        setOpen(false);
        load();
      } else {
        const res = await api.createProduct({
          name: v.name,
          description: v.description || '',
          price: String(v.price),
          coverUrl: v.coverUrl || '',
          status: v.status,
          sortOrder: v.sortOrder,
          categoryId: v.categoryId ?? null,
        });
        message.success('已创建，请导入卡密货源后才会显示剩余张数');
        setOpen(false);
        load();
        openKeys(res.product);
      }
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function doImport() {
    if (!keysProduct) return;
    if (!importText.trim()) {
      message.warning('请先粘贴卡密，一行一条');
      return;
    }
    setImporting(true);
    try {
      const res = await api.importProductKeys(keysProduct.id, importText);
      setUnusedCount(res.unusedCount);
      setImportText('');
      message.success(`已导入 ${res.imported} 条，跳过 ${res.skipped} 条（重复或无效）`);
      await loadKeys(keysProduct, keyFilter);
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            商品管理
          </Typography.Title>
          <Typography.Text type="secondary">
            上架 / 下架 / 改价 / 卡密货源（剩余张数由未用卡密自动计算）
          </Typography.Text>
        </div>
        <Button type="primary" className="candy-btn" icon={<PlusOutlined />} onClick={openCreate}>
          新增商品
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 980 }}
        columns={[
          {
            title: '封面',
            dataIndex: 'cover_url',
            width: 80,
            render: (url: string) =>
              url ? (
                <Image src={url} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 8 }} />
              ) : (
                '—'
              ),
          },
          { title: '名称', dataIndex: 'name' },
          {
            title: '分类',
            dataIndex: 'category_id',
            width: 110,
            render: (id: number | null) => catName(id),
          },
          {
            title: '价格',
            dataIndex: 'price',
            width: 100,
            render: (v: string) => <span className="price">¥{v}</span>,
          },
          {
            title: '剩余卡密',
            dataIndex: 'stock',
            width: 100,
            render: (n: number) => `${n} 张`,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (s: string) =>
              s === 'on' ? <Tag color="success">上架</Tag> : <Tag>下架</Tag>,
          },
          {
            title: '操作',
            width: 260,
            render: (_, p) => (
              <Space wrap>
                <Button type="link" icon={<KeyOutlined />} onClick={() => openKeys(p)}>
                  卡密货源
                </Button>
                <Button type="link" onClick={() => openEdit(p)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  onClick={async () => {
                    await api.updateProduct(p.id, {
                      status: p.status === 'on' ? 'off' : 'on',
                    });
                    load();
                  }}
                >
                  {p.status === 'on' ? '下架' : '上架'}
                </Button>
                <Popconfirm
                  title="确认删除？"
                  onConfirm={async () => {
                    await api.deleteProduct(p.id);
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
        title={editing ? '编辑商品' : '新增商品'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        destroyOnHidden
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="categoryId" label="分类">
            <Select
              allowClear
              placeholder="选择分类"
              options={categories.map((c) => ({
                value: c.id,
                label: `${c.icon || ''} ${c.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
          <Form.Item
            name="price"
            label="价格（元）"
            rules={[{ required: true, message: '请输入价格' }]}
          >
            <Input placeholder="例如 29.90" />
          </Form.Item>
          <Form.Item name="coverUrl" label="封面图 URL">
            <Input placeholder="https://..." />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="sortOrder" label="排序">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              name="status"
              label="上架"
              valuePropName="checked"
              getValueFromEvent={(c) => (c ? 'on' : 'off')}
              getValueProps={(v) => ({ checked: v === 'on' })}
            >
              <Switch checkedChildren="上架" unCheckedChildren="下架" />
            </Form.Item>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            剩余张数由卡密货源中的未用卡密自动计算，无需手工填写库存。
          </Typography.Paragraph>
        </Form>
      </Modal>

      <Drawer
        title={keysProduct ? `卡密货源 · ${keysProduct.name}` : '卡密货源'}
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
        width={720}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          一行一条。支持纯卡密（如 <code>XXXX-XXXX-XXXX</code>），或卡号+卡密：
          <code>卡号,卡密</code>、<code>卡号----卡密</code>、制表符或两个空格分隔的词。
          重复导入会自动跳过。
        </Typography.Paragraph>
        <Input.TextArea
          rows={6}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={'AAAA-BBBB-CCCC\nCARD001,SECRET001\nCARD002----SECRET002'}
        />
        <Space style={{ margin: '12px 0 20px' }} wrap>
          <Button type="primary" className="candy-btn" loading={importing} onClick={doImport}>
            导入卡密
          </Button>
          <Typography.Text>剩余未用 {unusedCount} 张</Typography.Text>
        </Space>

        <Radio.Group
          value={keyFilter}
          onChange={(e) => {
            const v = e.target.value as 'all' | 'unused' | 'sold';
            setKeyFilter(v);
            if (keysProduct) loadKeys(keysProduct, v);
          }}
          style={{ marginBottom: 12 }}
          optionType="button"
          options={[
            { label: '全部', value: 'all' },
            { label: '未用', value: 'unused' },
            { label: '已售', value: 'sold' },
          ]}
        />

        <Table
          rowKey="id"
          loading={keysLoading}
          dataSource={keys}
          size="small"
          scroll={{ x: 640 }}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '卡号',
              dataIndex: 'card_no',
              width: 120,
              render: (v: string | null) => v || '—',
            },
            { title: '卡密', dataIndex: 'secret', ellipsis: true },
            {
              title: '状态',
              dataIndex: 'status',
              width: 80,
              render: (s: string) =>
                s === 'sold' ? (
                  <Tag color="blue">已售</Tag>
                ) : s === 'reserved' ? (
                  <Tag color="orange">预占</Tag>
                ) : s === 'disabled' ? (
                  <Tag>停用</Tag>
                ) : (
                  <Tag color="success">未用</Tag>
                ),
            },
            {
              title: '订单',
              dataIndex: 'out_trade_no',
              width: 160,
              render: (v: string | null) => v || '—',
            },
            {
              title: '操作',
              width: 80,
              render: (_, row) =>
                row.status === 'sold' || row.status === 'reserved' ? (
                  <Typography.Text type="secondary">—</Typography.Text>
                ) : (
                  <Popconfirm
                    title="删除这张未用卡密？"
                    onConfirm={async () => {
                      if (!keysProduct) return;
                      try {
                        const res = await api.deleteProductKey(keysProduct.id, row.id);
                        setUnusedCount(res.unusedCount);
                        message.success('已删除');
                        loadKeys(keysProduct, keyFilter);
                        load();
                      } catch (e) {
                        message.error((e as Error).message);
                      }
                    }}
                  >
                    <Button type="link" danger size="small">
                      删除
                    </Button>
                  </Popconfirm>
                ),
            },
          ]}
        />
      </Drawer>
    </div>
  );
}

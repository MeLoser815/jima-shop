import { useEffect, useState } from 'react';
import { Alert, App, Card, Col, Row, Statistic, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ShoppingOutlined,
  TransactionOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { adminPath } from '../../adminPath';

export default function Dashboard() {
  const { message } = App.useApp();
  const [stats, setStats] = useState({
    productCount: 0,
    onSaleCount: 0,
    orderCount: 0,
    paidCount: 0,
    paidAmount: '0.00',
    pendingFulfillmentCount: 0,
  });
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    api
      .dashboard()
      .then((r) => {
        setStats({
          ...r.stats,
          pendingFulfillmentCount: r.stats.pendingFulfillmentCount ?? 0,
        });
        setConfigured(r.configured);
      })
      .catch((e) => message.error((e as Error).message));
  }, [message]);

  const pending = stats.pendingFulfillmentCount;

  return (
    <div>
      <Typography.Title level={3}>仪表盘</Typography.Title>
      <Typography.Paragraph type="secondary">
        一眼看清店铺状态，收款配置与商品上下架尽在掌握。
      </Typography.Paragraph>
      {!configured && (
        <Card className="glass-card" style={{ marginBottom: 16 }}>
          <Tag color="orange">待配置</Tag>
          尚未配置收款方式，
          <Link to={adminPath('settings')}>去设置支付宝当面付或可选的易支付收款 →</Link>
        </Card>
      )}
      {pending > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`有 ${pending} 笔已付款订单待补发卡密`}
          description={
            <span>
              买家已付款，但当时库存不足。请先补充卡密货源，再前往
              <Link to={`${adminPath('orders')}?fulfillment=pending_fulfillment`}>
                订单列表补发
              </Link>
              。
            </span>
          }
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Link to={adminPath('products')} style={{ display: 'block' }}>
            <Card className="stat-card glass-card" hoverable>
              <Statistic
                title="商品总数"
                value={stats.productCount}
                prefix={<ShoppingOutlined />}
              />
            </Card>
          </Link>
        </Col>
        <Col xs={12} md={6}>
          <Link to={adminPath('products')} style={{ display: 'block' }}>
            <Card className="stat-card glass-card" hoverable>
              <Statistic
                title="在售"
                value={stats.onSaleCount}
                prefix={<CheckCircleOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Link>
        </Col>
        <Col xs={12} md={6}>
          <Link to={adminPath('orders')} style={{ display: 'block' }}>
            <Card className="stat-card glass-card" hoverable>
              <Statistic
                title="订单数"
                value={stats.orderCount}
                prefix={<TransactionOutlined />}
              />
            </Card>
          </Link>
        </Col>
        <Col xs={12} md={6}>
          <Link to={`${adminPath('orders')}?payStatus=paid`} style={{ display: 'block' }}>
            <Card className="stat-card glass-card" hoverable>
              <Statistic
                title="已收款"
                value={stats.paidAmount}
                prefix={<WalletOutlined />}
                suffix="元"
                valueStyle={{ color: '#ff6b9d' }}
              />
              <div style={{ marginTop: 4, color: '#999', fontSize: 12 }}>
                成功 {stats.paidCount} 笔
              </div>
            </Card>
          </Link>
        </Col>
      </Row>
    </div>
  );
}

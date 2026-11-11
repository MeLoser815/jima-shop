import { useEffect, useState } from 'react';
import { App, Card, Col, Row, Statistic, Tag, Typography } from 'antd';
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
  });
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    api
      .dashboard()
      .then((r) => {
        setStats(r.stats);
        setConfigured(r.configured);
      })
      .catch((e) => message.error((e as Error).message));
  }, [message]);

  return (
    <div>
      <Typography.Title level={3}>仪表盘</Typography.Title>
      <Typography.Paragraph type="secondary">
        一眼看清店铺状态，收款配置与商品上下架尽在掌握。
      </Typography.Paragraph>
      {!configured && (
        <Card className="glass-card" style={{ marginBottom: 16 }}>
          <Tag color="orange">待配置</Tag>
          尚未配置支付宝当面付密钥，
          <Link to={adminPath("settings")}>去填写 AppId / 私钥 / 公钥 →</Link>
        </Card>
      )}
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card className="stat-card glass-card">
            <Statistic
              title="商品总数"
              value={stats.productCount}
              prefix={<ShoppingOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="stat-card glass-card">
            <Statistic
              title="在售"
              value={stats.onSaleCount}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="stat-card glass-card">
            <Statistic
              title="订单数"
              value={stats.orderCount}
              prefix={<TransactionOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="stat-card glass-card">
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
        </Col>
      </Row>
    </div>
  );
}

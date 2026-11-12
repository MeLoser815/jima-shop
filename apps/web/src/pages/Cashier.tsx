import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Segmented,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QrcodeOutlined,
  ScanOutlined,
} from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';

type Phase = 'form' | 'qr' | 'success' | 'failed';

export default function CashierPage() {
  const { message } = App.useApp();
  const [amount, setAmount] = useState('0.01');
  const [subject, setSubject] = useState('店内收款');
  const [authCode, setAuthCode] = useState('');
  const [mode, setMode] = useState<'qr' | 'bar'>('qr');
  const [phase, setPhase] = useState<Phase>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{
    outTradeNo: string;
    totalAmount: string;
    subject: string;
    status: string;
    qrCode: string | null;
  } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  function stopPoll() {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }

  function startPoll(outTradeNo: string) {
    stopPoll();
    timer.current = window.setInterval(async () => {
      try {
        const local = await api.getOrder(outTradeNo);
        const st = local.order.status;
        if (st === 'TRADE_SUCCESS' || st === 'TRADE_FINISHED') {
          setPhase('success');
          setOrder((o) => (o ? { ...o, status: st } : o));
          stopPoll();
          return;
        }
        if (st === 'TRADE_CLOSED' || st === 'FAILED') {
          setPhase('failed');
          setOrder((o) => (o ? { ...o, status: st } : o));
          stopPoll();
          return;
        }
        try {
          const q = await api.queryAlipay(outTradeNo);
          const ts = q.tradeStatus || q.order?.status;
          if (ts === 'TRADE_SUCCESS' || ts === 'TRADE_FINISHED') {
            setPhase('success');
            setOrder((o) => (o ? { ...o, status: ts } : o));
            stopPoll();
          }
        } catch {
          // 查单失败不影响轮询本地
        }
      } catch {
        // ignore transient
      }
    }, 2500);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'qr') {
        const res = await api.precreate({ amount, subject });
        setOrder(res.order);
        setPhase('qr');
        startPoll(res.order.outTradeNo);
        message.success('收款码已生成');
      } else {
        const res = await api.payBarCode({ amount, subject, authCode });
        const o = res.order;
        setOrder({
          outTradeNo: o.out_trade_no,
          totalAmount: o.total_amount,
          subject: o.subject,
          status: o.status,
          qrCode: o.qr_code ?? null,
        });
        if (o.status === 'TRADE_SUCCESS' || o.status === 'TRADE_FINISHED') {
          setPhase('success');
          message.success('支付成功');
        } else {
          setPhase('qr');
          startPoll(o.out_trade_no);
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setPhase('form');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    stopPoll();
    setPhase('form');
    setOrder(null);
    setError(null);
  }

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={14}>
        <Card
          title={
            <Space>
              <Typography.Text strong className="hero-title" style={{ fontSize: 22 }}>
                收银台
              </Typography.Text>
              <Tag color="blue">支付宝当面付</Tag>
            </Space>
          }
          extra={<Typography.Text type="secondary">收款码 / 付款码</Typography.Text>}
        >
          <Segmented
            block
            value={mode}
            onChange={(v) => setMode(v as 'qr' | 'bar')}
            options={[
              {
                label: '收款码（买家扫）',
                value: 'qr',
                icon: <QrcodeOutlined />,
              },
              {
                label: '付款码（商家扫）',
                value: 'bar',
                icon: <ScanOutlined />,
              },
            ]}
            style={{ marginBottom: 20 }}
          />

          {error && (
            <Alert
              type="error"
              showIcon
              message={error}
              style={{ marginBottom: 16 }}
              closable
              onClose={() => setError(null)}
            />
          )}

          {phase === 'form' && (
            <form onSubmit={onSubmit}>
              <Form layout="vertical" requiredMark="optional">
                <Form.Item label="金额（元）" required>
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    size="large"
                    prefix="¥"
                    required
                  />
                </Form.Item>
                <Form.Item label="商品名称" required>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    size="large"
                    required
                  />
                </Form.Item>
                {mode === 'bar' && (
                  <Form.Item label="买家付款码 auth_code" required>
                    <Input
                      value={authCode}
                      onChange={(e) => setAuthCode(e.target.value)}
                      placeholder="扫描买家支付宝付款码"
                      size="large"
                      required
                    />
                  </Form.Item>
                )}
                <Button type="primary" htmlType="submit" size="large" loading={busy} block>
                  {mode === 'qr' ? '生成收款码' : '发起付款码支付'}
                </Button>
              </Form>
            </form>
          )}

          {(phase === 'qr' || phase === 'success' || phase === 'failed') && order && (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Space wrap>
                {phase === 'success' && (
                  <Tag icon={<CheckCircleOutlined />} color="success">
                    支付成功
                  </Tag>
                )}
                {phase === 'failed' && (
                  <Tag icon={<CloseCircleOutlined />} color="error">
                    已关闭/失败
                  </Tag>
                )}
                {phase === 'qr' && <Tag color="processing">等待买家付款</Tag>}
                <Typography.Text className="mono" type="secondary">
                  {order.outTradeNo}
                </Typography.Text>
              </Space>
              <Statistic title={order.subject} prefix="¥" value={order.totalAmount} />
              {order.qrCode && phase === 'qr' && (
                <div className="qr-panel">
                  <QRCodeSVG value={order.qrCode} size={220} />
                  <Typography.Text className="mono" type="secondary">
                    {order.qrCode}
                  </Typography.Text>
                  <Alert
                    type="info"
                    showIcon
                    message="请使用支付宝扫码支付，页面将自动刷新状态"
                  />
                </div>
              )}
              {phase === 'success' && (
                <Alert type="success" showIcon message="订单已支付成功，可在管理后台查看。" />
              )}
              <Button onClick={reset}>再来一单</Button>
            </Space>
          )}
        </Card>
      </Col>

      <Col xs={24} lg={10}>
        <Card title="使用说明">
          <Typography.Paragraph type="secondary">
            首次使用请先到管理后台完成管理员设置，并配置支付宝三要素。
          </Typography.Paragraph>
          <ol style={{ color: 'rgba(0,0,0,0.65)', lineHeight: 1.9, paddingLeft: 18, marginTop: 0 }}>
            <li>打开「管理后台」，首次创建自己的账号密码</li>
            <li>填写 AppId / 应用私钥 / 支付宝公钥并保存</li>
            <li>回到本页，输入金额生成收款码</li>
            <li>买家扫码支付后，异步通知或主动查单会更新状态</li>
          </ol>
          <Alert
            type="info"
            showIcon
            message="若返回「无效的AppID」等业务错误，说明密钥或网关环境不匹配，请核对开放平台配置。"
          />
        </Card>
      </Col>
    </Row>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Result,
  Space,
  Spin,
  Typography,
} from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type PublicOrder } from '../../api';
import { useCart } from '../../cart';
import DeliveredKeys from '../../components/DeliveredKeys';

type PayOrder = {
  outTradeNo: string;
  totalAmount: string;
  subject: string;
  qrCode: string | null;
  status: string;
};

const HTTP_PAY_HINT =
  '当前不是通过 HTTPS 域名访问。请改用店铺的 HTTPS 地址打开后再支付，否则可能无法生成收款码。';

function isInsecurePublicHttp(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol === 'https:') return false;
  const host = window.location.hostname.toLowerCase();
  return !(
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost')
  );
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : '';
  return msg || '生成收款码失败，请稍后重试';
}

export default function PayPage() {
  const cart = useCart();
  const nav = useNavigate();
  const { message } = App.useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<PayOrder | null>(null);
  const [paid, setPaid] = useState(false);
  const [paidOrder, setPaidOrder] = useState<PublicOrder | null>(null);
  const [payError, setPayError] = useState('');
  const [httpHint, setHttpHint] = useState(
    isInsecurePublicHttp() ? HTTP_PAY_HINT : '',
  );
  const [alipayReady, setAlipayReady] = useState<boolean | null>(null);
  const cleared = useRef(false);

  useEffect(() => {
    api
      .getStorePayment()
      .then((res) => {
        setAlipayReady(res.alipayConfigured);
        if (res.insecureHttp && res.hint) setHttpHint(res.hint);
        else if (res.insecureHttp) setHttpHint(HTTP_PAY_HINT);
      })
      .catch(() => {
        /* 状态查询失败时仍允许点击下单，由下单接口返回明确错误 */
      });
  }, []);

  useEffect(() => {
    if (!order || paid) return;
    const t = setInterval(async () => {
      try {
        const local = await api.queryOrder(order.outTradeNo);
        const st = local.order.status;
        if (st === 'TRADE_SUCCESS' || st === 'TRADE_FINISHED' || st === 'SUCCESS') {
          setPaidOrder(local.order);
          setPaid(true);
          if (!cleared.current) {
            cleared.current = true;
            cart.clear();
          }
          return;
        }
      } catch {
        /* ignore poll errors */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [order, paid, cart]);

  async function startPay() {
    if (!cart.items.length) {
      message.warning('购物车为空');
      nav('/cart');
      return;
    }
    setPayError('');
    setBusy(true);
    try {
      const res = await api.checkout({
        items: cart.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
        buyerNote: note.trim() || undefined,
      });
      const qrCode = res.order?.qrCode?.trim() || '';
      if (!qrCode) {
        throw new Error('未能生成收款码，请稍后重试或联系商家');
      }
      setOrder({
        outTradeNo: res.order.outTradeNo,
        totalAmount: res.order.totalAmount,
        subject: res.order.subject,
        qrCode,
        status: res.order.status,
      });
      message.success('已生成收款码，请使用支付宝扫码');
    } catch (e) {
      const text = errorText(e);
      setPayError(text);
      message.error(text);
    } finally {
      setBusy(false);
    }
  }

  if (paid && order) {
    const view = paidOrder;
    const pending = view?.fulfillmentStatus === 'pending_fulfillment';
    return (
      <Card className="glass-card">
        <Result
          status={pending ? 'warning' : 'success'}
          title={pending ? '支付成功，商家将为您补发卡密' : '支付成功啦 ✧'}
          subTitle={`商户单号 ${order.outTradeNo} · ¥${order.totalAmount}。请妥善保存卡密，也可稍后通过查单再次查看。`}
        />
        <DeliveredKeys
          keys={view?.keys ?? []}
          pending={pending}
          messageText={view?.message}
        />
        <Space style={{ marginTop: 20, width: '100%', justifyContent: 'center' }} wrap>
          <Link to={`/order?no=${encodeURIComponent(order.outTradeNo)}`}>
            <Button>查单</Button>
          </Link>
          <Link to="/">
            <Button type="primary" className="candy-btn">
              回首页
            </Button>
          </Link>
        </Space>
      </Card>
    );
  }

  if (order?.qrCode) {
    return (
      <Card className="glass-card pay-qr-card">
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          支付宝扫码支付
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          {order.subject} · ¥{order.totalAmount}
        </Typography.Paragraph>
        <div className="qr-panel cute">
          <QRCodeSVG value={order.qrCode} size={220} includeMargin />
          <Spin tip="等待支付中…" />
          <div className="mono">{order.outTradeNo}</div>
        </div>
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 16 }}
          message="请使用支付宝扫描上方二维码。支付完成后页面会自动展示卡密。也可凭商户单号到「查单」查看。"
        />
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Link to={`/order?no=${encodeURIComponent(order.outTradeNo)}`}>打开查单</Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <Typography.Title level={3}>确认订单 💖</Typography.Title>
      {!cart.items.length ? (
        <Alert
          type="warning"
          message="购物车为空"
          action={
            <Link to="/">
              <Button size="small">去选购</Button>
            </Link>
          }
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {cart.items.map((it) => (
            <div key={it.productId} className="checkout-line">
              <span>
                {it.name} × {it.quantity}
              </span>
              <span className="price">
                ¥{(Number(it.price) * it.quantity).toFixed(2)}
              </span>
            </div>
          ))}
          <div className="checkout-line total">
            <span>应付</span>
            <span className="price big">¥{cart.total.toFixed(2)}</span>
          </div>
          <Input.TextArea
            rows={2}
            maxLength={200}
            placeholder="备注（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {alipayReady === false && (
            <Alert
              type="warning"
              showIcon
              message="商家暂未开通在线支付，请稍后再试或联系商家"
            />
          )}
          {httpHint && (
            <Alert type="warning" showIcon message={httpHint} />
          )}
          {payError && (
            <Alert type="error" showIcon message={payError} />
          )}
          {!httpHint && alipayReady !== false && !payError && (
            <Alert type="info" showIcon message="请使用支付宝扫码完成支付。点击下方按钮生成收款码。" />
          )}
          <Button
            type="primary"
            size="large"
            block
            className="candy-btn"
            loading={busy}
            onClick={() => void startPay()}
          >
            生成支付宝收款码
          </Button>
        </Space>
      )}
    </Card>
  );
}

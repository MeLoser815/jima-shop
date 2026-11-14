import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Radio,
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
  payUrl?: string;
  payScheme?: string;
  payMethod?: string;
  status: string;
};

type PayMethod = { id: string; label: string };

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

function scanHint(label?: string): string {
  const name = label || '支付宝';
  if (name === '微信') return '请使用微信扫描上方二维码。支付完成后页面会自动展示卡密。也可凭商户单号到「查单」查看。';
  if (name === 'QQ钱包') return '请使用 QQ 钱包扫描上方二维码。支付完成后页面会自动展示卡密。也可凭商户单号到「查单」查看。';
  return '请使用支付宝扫描上方二维码。支付完成后页面会自动展示卡密。也可凭商户单号到「查单」查看。';
}

function payTitle(label?: string): string {
  const name = label || '支付宝';
  if (name === '微信') return '微信扫码支付';
  if (name === 'QQ钱包') return 'QQ钱包扫码支付';
  return '支付宝扫码支付';
}

function startButtonLabel(methods: PayMethod[], selected?: string): string {
  const current = methods.find((m) => m.id === selected) || methods[0];
  const name = current?.label || '支付宝';
  return `生成${name}收款码`;
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
  const [methods, setMethods] = useState<PayMethod[] | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string>('');
  const cleared = useRef(false);

  useEffect(() => {
    api
      .getStorePayment()
      .then((res) => {
        const list = res.methods?.length
          ? res.methods
          : res.alipayConfigured
            ? [{ id: 'alipay_f2f', label: '支付宝' }]
            : [];
        setMethods(list);
        setSelectedMethod((prev) => prev || list[0]?.id || '');
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
    const paymentMethod =
      selectedMethod || (methods && methods.length === 1 ? methods[0].id : '');
    if (methods && methods.length > 1 && !paymentMethod) {
      message.warning('请选择支付方式');
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
        paymentMethod: paymentMethod || undefined,
      });
      const qrCode = res.order?.qrCode?.trim() || '';
      const payUrl = res.order?.payUrl?.trim() || '';
      const payScheme = res.order?.payScheme?.trim() || '';
      if (!qrCode && !payUrl && !payScheme) {
        throw new Error('未能生成收款码，请稍后重试或联系商家');
      }
      setOrder({
        outTradeNo: res.order.outTradeNo,
        totalAmount: res.order.totalAmount,
        subject: res.order.subject,
        qrCode: qrCode || payUrl || payScheme,
        payUrl: payUrl || undefined,
        payScheme: payScheme || undefined,
        payMethod: res.order.payMethod,
        status: res.order.status,
      });
      message.success(`已生成收款码，请使用${res.order.payMethod || '支付宝'}扫码`);
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
          {payTitle(order.payMethod)}
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
          message={scanHint(order.payMethod)}
        />
        {(order.payUrl || order.payScheme) && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Button
              type="primary"
              className="candy-btn"
              href={order.payUrl || order.payScheme}
              target="_blank"
              rel="noreferrer"
            >
              打开支付页
            </Button>
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Link to={`/order?no=${encodeURIComponent(order.outTradeNo)}`}>打开查单</Link>
        </div>
      </Card>
    );
  }

  const ready = methods === null ? null : methods.length > 0;
  const showChooser = (methods?.length ?? 0) > 1;

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
          {ready === false && (
            <Alert
              type="warning"
              showIcon
              message="商家暂未开通在线支付，请稍后再试或联系商家"
            />
          )}
          {showChooser && methods && (
            <div>
              <Typography.Text style={{ display: 'block', marginBottom: 8 }}>
                选择支付方式
              </Typography.Text>
              <Radio.Group
                value={selectedMethod}
                onChange={(e) => setSelectedMethod(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                options={methods.map((m) => ({ value: m.id, label: m.label }))}
              />
            </div>
          )}
          {httpHint && (
            <Alert type="warning" showIcon message={httpHint} />
          )}
          {payError && (
            <Alert type="error" showIcon message={payError} />
          )}
          {!httpHint && ready !== false && !payError && (
            <Alert
              type="info"
              showIcon
              message={
                showChooser
                  ? '请选择支付方式并生成收款码，使用对应应用扫码完成付款。'
                  : `请使用${methods?.[0]?.label || '支付宝'}扫码完成支付。点击下方按钮生成收款码。`
              }
            />
          )}
          <Button
            type="primary"
            size="large"
            block
            className="candy-btn"
            loading={busy}
            disabled={ready === false}
            onClick={() => void startPay()}
          >
            {methods && methods.length
              ? startButtonLabel(methods, selectedMethod)
              : '生成支付宝收款码'}
          </Button>
        </Space>
      )}
    </Card>
  );
}

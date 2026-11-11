import { App, Button, Space, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { DeliveredKey } from '../api';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function DeliveredKeys({
  keys,
  pending,
  messageText,
}: {
  keys: DeliveredKey[];
  pending?: boolean;
  messageText?: string;
}) {
  const { message } = App.useApp();

  async function copyOne(k: DeliveredKey) {
    const ok = await copyText(k.text);
    if (ok) message.success('已复制');
    else message.error('复制失败，请手动选择复制');
  }

  async function copyAll() {
    const text = keys.map((k) => k.text).join('\n');
    const ok = await copyText(text);
    if (ok) message.success(`已复制全部 ${keys.length} 条卡密`);
    else message.error('复制失败，请手动选择复制');
  }

  return (
    <div className="delivered-keys">
      {pending && (
        <Typography.Paragraph type="warning">
          {messageText ||
            '部分或全部卡密暂未能自动发出，商家将尽快为您补发。补发完成后可通过查单查看；在商家处理前，再次查单不会自动完成发货。'}
        </Typography.Paragraph>
      )}
      {keys.length > 0 && (
        <>
          <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
            <Typography.Text strong>已发放卡密（请自行保存）</Typography.Text>
            <Button size="small" icon={<CopyOutlined />} onClick={copyAll}>
              复制全部
            </Button>
          </Space>
          <ul className="key-list">
            {keys.map((k) => (
              <li key={k.id} className="key-item">
                <div className="key-body">
                  <div className="key-product">{k.productName}</div>
                  {k.cardNo ? (
                    <div className="mono">
                      卡号：{k.cardNo}
                      <br />
                      卡密：{k.secret}
                    </div>
                  ) : (
                    <div className="mono">{k.secret}</div>
                  )}
                </div>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copyOne(k)}>
                  复制
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!keys.length && !pending && (
        <Typography.Text type="secondary">暂无卡密（可能是直接收款订单）</Typography.Text>
      )}
    </div>
  );
}

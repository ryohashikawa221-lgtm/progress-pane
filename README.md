# progress-pane

Claude Code の横の枠と入力欄の下の 1 行に、作業の進行状況（項目ごとの段のバー）と週の使用量の残りを出すモッドです。

- 週の使用量の残り：このセッションの値を読みます（無ければ `~/.claude/usage-latest.json` があればそれを読みます）。15% 未満で赤、30% 未満で黄色。
- 進行状況：JSON ファイルを 1 分ごとに読み直します。
- `/progress` で枠を開き、同じ中身を文字でも返します。

## 入れ方

ターミナルの Claude Code の入力欄で：

```
/plugin install progress-pane --marketplace ryohashikawa221-lgtm/progress-pane
```

シェルから：

```
claude plugin install progress-pane --marketplace ryohashikawa221-lgtm/progress-pane
```

デスクトップアプリ：入力欄の横の + → Plugins → Add marketplace に `ryohashikawa221-lgtm/progress-pane` → Add plugin。

## 進行状況のファイル

既定は `~/.claude/progress/STATUS.json`。設定の `statusFile` で場所を変えられます。

```json
{
  "title": "今週の作業",
  "updated_at": "2026-11-09T09:00:00+09:00",
  "stages": ["作る", "試験", "確認", "公開"],
  "items": [
    { "no": "1", "name": "請求書", "stage": 2, "now": "試験中", "next": "確認" },
    { "no": "2", "name": "通知", "stage": 4, "now": "公開済み" }
  ],
  "waiting": "なし",
  "waiting_label": "あなたの番"
}
```

`stage` が `stages` の数に届くと完了として緑になります。`waiting` が「なし」以外なら、下の 1 行に「あなたの番あり」と出ます。

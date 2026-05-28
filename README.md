# АкадемМОТО mobile

Статический сайт для iPhone/Safari. Сервер не нужен: сайт напрямую работает с Supabase через publishable key и Supabase Auth.

## Локальный запуск

```bash
cd "/Users/viktor/Documents/Master 2.0/mobile_site"
python3 -m http.server 8765
```

Открыть:

```text
http://127.0.0.1:8765
```

## Бесплатный хостинг

Подойдут бесплатные варианты:

- GitHub Pages
- Vercel
- Netlify
- Cloudflare Pages

Загрузи содержимое папки `mobile_site` как статический сайт.

## Что уже умеет

- вход через Supabase Auth;
- создание клиента и техники;
- создание запчасти, расходника или работы;
- создание заказ-наряда с позициями;
- просмотр последних заказов;
- просмотр клиентов.

## Важно

Перед использованием выполни в Supabase SQL-скрипты:

1. `supabase_schema.sql`
2. `supabase_deleted_at.sql`

Таблицы должны быть доступны для роли `authenticated`.

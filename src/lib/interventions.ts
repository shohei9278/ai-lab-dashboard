import { db } from "./db";
import { jstDay } from "./sns";

// 人の手の記録: AIに任せきりではなく、人がどこで問題を見つけ、何を決めたのかを、AIがやったことと分けて公開する
// - 開発・保守への介入: このページの事例（手で書く）
// - AIの事業運営への介入: 処理の記録から自動で数える（operationCounts）

export type InterventionKind = "bug" | "design" | "direction";
export const INTERVENTION_KIND: Record<InterventionKind, string> = { bug: "不具合", design: "仕組みの変更", direction: "方針の判断" };

// 問題を最初に見つけたのは誰（何）か。同じ問題を複数で見つけることもある
export const FOUND_BY = { human: "人", gpt: "GPTのレビュー", test: "自動テスト", release: "公開後" } as const;
export type FoundBy = keyof typeof FOUND_BY;

// 列の意味: happened = 問題 / noticed = 人の対応 / decision = AIの対応 / result = 修正後の結果
export type InterventionRow = { id: number; day: string; kind: InterventionKind; title: string; happened: string; noticed: string; decision: string; result: string | null; found_by: string | null; commit_sha: string | null };

export const commitUrl = (sha: string) => `https://github.com/shohei9278/ai-lab-dashboard/commit/${sha}`;
const isFoundBy = (k: unknown): k is FoundBy => typeof k === "string" && Object.hasOwn(FOUND_BY, k);
export const foundByLabels = (v: string | null) => (v ?? "").split(",").filter(isFoundBy).map((k) => FOUND_BY[k]);

// これまでの実際の事例。key ごとにコードの内容で更新するので、文面やコミットを直せば次の起動で反映される（消した記録は消したまま）
const FIRST: (Omit<InterventionRow, "id"> & { key: string })[] = [
  { key: "showcase-office", day: "2026-11-13", kind: "design", title: "概要ページも、ドット絵のオフィスとロボットの社員の見た目にそろえた", happened: "ホームにはドット絵のオフィスとロボットの社員が入ったが、ポートフォリオとして見せる概要ページ（/showcase）は文字と表だけのままで、来た人に何をしている会社かが伝わりにくかった。公開した案件の表には登録率 0.0% が並んでいた。", noticed: "「ポートフォリオ側の見た目も変えた方が良い」と指摘した。", decision: "Claude Codeが、概要ページの一番上に、ホームと同じオフィスを見るだけの形（部屋や物から機能に移らず、判断待ちなどの件数とAIの会話の中身を出さない）で置いた。AIどうしの採点の表を社員3人の紹介カード（ロボットの絵・よくしている仕事・選ばれたアイデアの数・採点の傾向）に移し、公開した案件の表を、公開前の確認で撮った画面写真つきのカードにして「訪問◯人・まだ登録なし」と書くようにした。日報・人の手の記録・気づいたことは件数を絞った。", result: "テストと、手元のデータベースの写しを使ったPCとスマホの画面で確かめた。本番での見え方はまだ確かめていない。", found_by: "human", commit_sha: "17ec07e" },
  { key: "office-view", day: "2026-11-12", kind: "direction", title: "AIの社員が何をしているかを、オフィスの部屋の位置で見せる試作を作った", happened: "AIの社員の動きは、ライブ画面の文字の一覧でしか見られず、来た人が一目で何をしている会社か分かりにくかった。", noticed: "ほかのサービスのオフィス風の画面を見せ、「AIがLPを作っていたら開発部、会議中なら会議室」のように一目で分かる画面にしたいと提案した。まず図形だけの試作から始め、動きと演出、情報、見た目（ロボット・部屋・案件通り）の順に作り込むと決めた。ホームのファーストビューにすること、部屋や物から機能に移れること、動いていないときはお知らせだけにして過去の動きは押して再生することを求め、他のAIの意見も聞くよう指示した。", decision: "Claude Codeが、AIを呼んだ記録の目的から、開発室・会議室・広報デスク・休憩室のどこにいるかを決め、社員の声と提案を吹き出しにする画面を作った。動きがないときは直近24時間を早送りで再生する。見せてもらった画面の見た目はまねていない。", result: "GPTとGeminiは、来訪者には良いが運営者の毎日の確認の邪魔になると指摘したため、来訪者にはホームの最初に、運営者には確認の一覧の下に出す形にした。部屋の割り当て・数字・店の取り出しをテストで、来訪者と運営者の画面・再生・床を押したときの移動を手元の写しで確かめた。来訪者のボタンを止める仕組みにオフィスのボタンが止められていたのを、確認中に見つけて直した。その後、運営者が「安っぽく見える」と別のサービスの画面を示したため、見た目を、画像のAIで作ったオフィスの背景（人物なし）の上にロボットや看板を重ねる形に変えた。さらに写真風とドット絵風を並べて見比べ、運営者がドット絵風を選び、外の景色のない、上から見た明るいオフィスにして、設定に移れる社長室を足すよう求めたため、背景を作り直し、手前の案件通りは室内の案件の展示に置き換えた。運営者が、絵文字は安っぽく見えること、吹き出しが途中で切れていること、本番の案件は12件ほどあり並べきれないことを指摘したため、絵文字を線の印に替え、吹き出しを全文出し、案件は公開中の数と今日の訪問、作業中の案件だけを絵に出し、横の一覧は上位5件にした。運営者が、開発室と会議室で説明の文字が上の端で切れていると指摘したため、上の端に近い場所の説明を枠の内側か下に出すよう直した。最後に運営者が、オフィスの専用ページはなくして、ホームの大きな数字の下に置くだけで良いと決めたため、専用ページとメニューの項目を消し、来訪者・運営者ともホームの大きな数字のすぐ下に出す形にした。運営者が、判断待ちも社長室にあるほうが良いのではと言い、Claude Codeが社長室と机は判断待ち（件数の丸つき）、設定は社長室の書類棚、提案箱は広報デスクの掲示板のままとする案を出して、運営者が了承した。続けて運営者が、ホームの「確認・対応」と「今日のAIの計画」はもういらないかと尋ねた。Claude Codeは、確認・対応には判断待ちにない確認（AIだけの公開・止まった作業・連絡・コメント）があり、スマホでは文字の一覧のほうが使いやすいので残し、計画はホワイトボードとメニューから行けるので外せると答え、運営者が計画を外すと決めた。計画の欄にだけあった「まだ見ていない投稿」のお知らせは、確認・対応の欄に移した。さらに運営者が、ライブの内容と掛け合わせれば、会議室にいるときに実際に何を話しているかが分かると提案したため、ライブの「AIの会話」（アイデアの提案・採点・判断・議論）を、話した社員の吹き出しと再生に流し、社員を押すと最近の発言を全文で読めるようにした。来た人には、ライブと同じ伏せ方をそろえた。運営者が、吹き出しだと情報が多くて見切れるので横に置くか社員の状態に出せばよいと指摘したため、会話は吹き出しから外し、社員の状態の各社員の欄に最新の発言を出して、長いものは「続きを読む」で開くようにした。運営者が、それでは社員の状態が長くなりすぎること、ライブの画面はオフィスと同じ働きなのでまとめたいことを指摘したため、社員の状態は元の短い形に戻し、ライブの画面（いまAIがやっていること・AIの会話・処理のログ）をホームのオフィスの下の欄にまとめた。会話とログは切り替えにし、前の /live のURLはその欄に移すだけにした。運営者が、直近24時間の再生のときはライブも連動させたいと求めたため、再生中は会話とログをその時刻までに絞り、直前の会話を光らせるようにした（ライブのログは直近30件しかないので、再生中のAIの呼び出しはオフィスが持つ24時間分の記録から出す）。運営者が、ライブにつぶやきが出ないことに気づき、AIの出力は全体的に入れておきたいと求めたため、ライブの会話に、つぶやき・朝会の計画・提案箱への提案・日報の見出し・週の定例会議のまとめ・教訓・AIが書いた資料・調べ物の答えを足した。下書き（日報の note・週のレポート）は入れず、調べ物の答えは運営者だけに出す。運営者が、今すぐ会議・アイデア出し・投稿の収集のボタンもホームにあれば、押してそのまま動きを見られると提案したため、ライブの欄の「いまAIがやっていること」に、運営者にだけ出す指示のボタン（今すぐ会議・AIにアイデアを出させる・話題の投稿を集める）を置き、押したものの入力欄だけを開くようにした。運営者が、練習用の「アイデア出しを見る」はいらないと判断して外し、ホームの構成を他のAIにも確認するよう求めた（ライブとオフィスの動きが一緒に見づらいことが難点だと指摘した）。GPTとGeminiはどちらも、オフィスとライブを横に並べること、ホームが縦に長すぎることを挙げたため、PCではオフィスの右の欄を［ライブ／社員の状態／案件］のタブにして絵と同じ高さにそろえ、スマホではライブを最新3件・1件4行までにして「もっと見る」「続きを読む」で開くようにした。重なっていた最近の動きの帯は外し、確認・対応の一覧は上位3件にした。PRの別のAIのレビューで、動きを減らす設定の人にもロボットが歩くことを指摘されたため、その設定では歩かせずに席へそのまま置くようにした（ほかの指摘は、運営者が決めて変えた点と最初の説明文との食い違いだったので、説明文を今の形に直した）。本番での見え方はまだ確かめていない。", found_by: null, commit_sha: "c75449c" },
  { key: "prompt-compare", day: "2026-11-12", kind: "direction", title: "指示の渡し方でLPの質が変わるかを、試せるようにした", happened: "LPを作るAIへの指示には「あなたは〜です」という役割の一文や、不具合のたびに足した禁止事項が入っていたが、渡し方を変えると質が変わるのかは確かめていなかった。", noticed: "プロンプトの渡し方の差を出しているか尋ね、試すとしても「AIの成績」のページでテストして結果を見られる程度でよいと決めた。役割の一文以外の差もまとめて試せるようにすると決めた。", decision: "Claude Codeが、役割の一文・守ることの量・見本・対象者の目・考える量・見直しの6つを、同じ案件・同じAIで1か所だけ変えて2つのLPを作り、3社が作り方を伏せて画面で採点する比較を、AIの成績に足した。作ったLPは案件には使わない。", result: "ふだんの指示が変わらないことと、比較の集計・始める前の確認をテストで確かめた。画面は見本の結果で確かめた。実際に比較を動かした結果はまだない。", found_by: null, commit_sha: "2fc98e3" },
  { key: "judge-meetings", day: "2026-11-12", kind: "bug", title: "判断の会議が会議室にほとんど出ていなかった", happened: "会議室の「判断の会議」は、AIどうしの意見が割れ、しかも人の承認が必要だった判断のあとの議論だけを出していた。全自動で進んだ判断や、意見がそろった判断は、3社が毎回判断していても会議室に出なかった。", noticed: "「判断の会議あるはずなのに会議室に表示されてない」と指摘した。", decision: "Claude Codeが、表示の条件が議論の記録に限られていたことを調べ、毎回残っている3社の判断と理由から会議を作るように直した。議論があった回は、その中身も付ける。", result: "テストと、手元のデータベースの写しに見本の判断を入れた画面で確かめた。本番の過去の判断がどう並ぶかは、反映したあとに確かめる。", found_by: "human", commit_sha: "2cbcab8" },
  { key: "growth-foundation", day: "2026-11-12", kind: "direction", title: "訪問が伸びない原因を、集客の仕組みから直した", happened: "9日間の訪問は1日13人前後で横ばいだった。115件中110件がSNSの自動投稿のリンクからで、検索・一覧・ほかのページからは0件。事前登録は0件、ツールの利用は2件。1日13人を16件で分け合うため、どの案件も判断の基準（100人）に届かず、数人の数字で撤退まで自動で進みうる状態だった。自由に書いたページは枠の中にあり、検索エンジンから読める文章は約50文字だった。", noticed: "伸びなくなっている可能性を疑い、集客とコンテンツの質の観点でのコードレビューと、他のAIの意見を求めた。挙がった7項目を、すべて直すと決めた。", decision: "Claude Codeが本番の数字とコードから原因を調べ、GPT・Geminiの意見と突き合わせた（Geminiの「運営者名が隠れている」「10秒で利用とみなす」は誤り・水増しとして採らなかった）。基準未満の撤退は人の判断に回し、流入で育てられる件数を超えたら新しい案件を休むようにした。sitemap・robots・canonical、枠の外の概要、ほかのツールへの案内、利用の数え方、結果入りのシェア文、作ると決まっていないことを正直に書く指示、公開時の手作業の届け方の提案、1訪問あたりの費用の計画への受け渡しを入れた。", result: "テスト、型チェック、公開サイトのビルド、手元の画面（スマホ幅・ダークモード、運営者の印で計測を止めた状態）で確かめた。訪問が増えるかは、公開後の数字を見るまで分からない。すでに公開中のページの「開発中」の文言は、作り直すまで残る。", found_by: null, commit_sha: "d6fe83d" },
  { key: "tool-review-preview", day: "2026-11-11", kind: "bug", title: "ページに出ない画面イメージを理由に、改善したツールの公開が止まっていた", happened: "ツールの改善で、ページに出さずに捨てる画面イメージの下書きをAIがチェックし、本物のツールの選択肢と合わないと誤って指摘して、改善した版の公開を止めていた（案件#35）。", noticed: "指摘を読んで「そもそも指摘内容がわからない。こんなのあるかな」と疑い、確認を依頼した。", decision: "Claude Codeが本番の第2版・第3版のページとツールを開き、指摘された文がどこにもないことと、チェックが捨てる前の下書きを見ていたことを確かめて、チェックの前に画面イメージを外した。", result: "テストで、チェックに画面イメージが渡らないことを確かめた。本番で次の改善が止まらずに進むかはまだ確かめていない。", found_by: "human,release", commit_sha: "a20ecf7" },
  { key: "version-compare", day: "2026-11-11", kind: "design", title: "公開中の版と改善した版を、名前付きで開いて見比べられるようにした", happened: "改善した版がチェックで止まったとき、試すリンクに版の番号も公開中かどうかも書かれておらず、古い版は開けず、2つの版を並べて見比べることもできなかった。", noticed: "案件#35の改善で問題が残ったのを見て、公開中のものと改善したもののどちらも見られる状態にすべきだと指摘した。", decision: "Claude Codeが、どの版もプレビューで開けるようにし、2つの版を並べる画面を作り、リンクに「第3版（未公開・最新）」のような名前を付けた。", result: "本番のデータの写しで、公開中・未公開・過去の版を開けることと、見比べの画面を確かめた。本番での確認はまだ。", found_by: "human", commit_sha: "697f1bd" },
  { key: "traffic-sources", day: "2026-11-11", kind: "design", title: "どこから来たかを、ページの中での動きと合わせて見られるようにした", happened: "公開サイトは来た元のページを記録していたが、ダッシュボードでは読んでおらず、どこから来た人が使ってくれたのかが分からなかった。", noticed: "案件の詳細に、どのサイトから来たかの分析を足し、ページの中での動きと合わせて見たいと依頼した。", decision: "Claude Codeが、記録済みのデータを調べて、Threads から来た人は来た元が Facebook と記録されることを見つけ、投稿の専用リンクを優先して流入元を分け、流入元ごとにどこまで進んだかを数えるようにした。AIの判断の材料にも入れた。", result: "本番のデータの写しで、流入元ごとの人数と進んだ段を確かめた。本番での確認はまだ。", found_by: "human", commit_sha: "74628f1" },
  { key: "page-structure-rest", day: "2026-11-11", kind: "design", title: "案件の数字を上に移し、見出しと投稿の確認の置き場所を整えた", happened: "案件の詳細では一番見たい集客の数字がページの下の方にあり、ホームと概要ページは同じ見出しだった。AIの投稿の確認は、投稿の一覧がある集客のページではなく毎日の計画にあった。", noticed: "見直し案の残りも進めると決めた。", decision: "Claude Codeが、集客の結果を案件の詳細の上に移してAIのアイデアを折りたたみ、ホームの見出しを「運営ダッシュボード」に変え、投稿の確認を集客のページへ移した。", result: "データのコピーを使った手元の画面で確かめた。本番での確認はまだ。", found_by: "human", commit_sha: "cbb627a" },
  { key: "page-structure", day: "2026-11-11", kind: "design", title: "ホームを毎日の確認と判断に絞り、メニューを組み直した", happened: "ホームに社員の声・処理ログ・集客・アイデア出しなどが並び、ほかのページと内容が重なって長くなっていた。毎日の計画はメニューになかった。", noticed: "ページ構成の見直しを依頼し、AI3社の意見から直す範囲（ホーム・メニュー・提案箱・概要ページ）を選んだ。", decision: "Claude Codeが全ページを撮って構成を書き出し、GPTとGeminiにも別々に意見を聞いてまとめ、選ばれた範囲を直した。", result: "データのコピーを使った手元の画面で確かめた。本番での確認はまだ。", found_by: "human", commit_sha: "357753a" },
  { key: "offsite-backup", day: "2026-11-10", kind: "design", title: "データベースの写しを外部にも残すようにした", happened: "毎日の写しはデータベースと同じ保存場所にしかなく、保存場所ごと失うと写しも一緒に消える状態だった。", noticed: "優先度の表でバックアップの確認を挙げ、保存先を Supabase に決めた。", decision: "Claude Codeが、毎日の写しを圧縮して Supabase の非公開の保存領域へ送り、30日分残す形にした。失敗したらエラーの通知が届くようにした。", result: "データのコピーで、送信・非公開であること・取り出して開けることを確かめた。本番の写しが届くかはまだ確かめていない。", found_by: "human", commit_sha: "d6ff709" },
  { key: "guest-drafts", day: "2026-11-10", kind: "bug", title: "投稿前の下書きが来訪者にも見えていた", happened: "発信の下書きのページで、noteの記事と個人アカウント用の投稿の下書きが、ログインしていない人にも表示されていた。", noticed: "全ページをAIに見せることを決め、報告を読んで直すと判断した。", decision: "Claude Codeが来訪者の画面を確認して見つけ、下書きのデータを運営者にだけ渡す形に直した。", result: "本番で、来訪者には下書きが送られないことを確かめた。運営者に表示されることは手元で確かめた。", found_by: "release", commit_sha: "c747248" },
  { key: "mobile-tables", day: "2026-11-10", kind: "bug", title: "スマホで表の列が押しつぶされていた", happened: "概要ページや集客のページなど9ページの表で、スマホ幅になると列が縮み、文字が1〜3字ずつ折り返されていた。", noticed: "「特にスマホ表示が怪しい箇所がある」と伝えて全ページをAIに見せることを決め、報告を読んで表から直すと判断した。", decision: "Claude Codeが全ページの画面を撮って崩れを洗い出し、主要な表はスマホだけカード形式に、列の多い表は横スクロールで読める形に直した。", result: "本番で、スマホ幅（375px・320px）で列がつぶれないことを確かめた。PC幅の表示は手元で確かめた。", found_by: "human,release", commit_sha: "3e95f22" },
  { key: "showcase-sidebar", day: "2026-11-10", kind: "bug", title: "概要ページからダッシュボードに移るとサイドバーが出なかった", happened: "公開の概要ページ（/showcase）からリンクでダッシュボードに移ると、サイドバーが表示されなかった。", noticed: "本番の画面で気づき、レイアウトの該当コードを示して「一旦判定したままになってそう」と原因の見当を伝えた。", decision: "Claude Codeが、ルートのレイアウトはページを移っても作り直されないことを確かめ、ページの判定を画面側に移した。", result: "本番で、概要ページとダッシュボードの行き来でサイドバーが正しく出し分けられることを確かめた。", found_by: "human,release", commit_sha: "7de6f71" },
  { key: "external-font", day: "2026-11-10", kind: "design", title: "ダッシュボードの外部フォントをやめた", happened: "ビルドの失敗を避けるためにGoogleフォントをブラウザから読む形にしたところ、閲覧者の情報がGoogleに送られるようになった。", noticed: "GPTの指摘を読み、外部フォントの読み込みを外すと決めた。", decision: "GPTがコードレビューで問題を指摘した。Claude Codeが、端末やサーバーに入っているフォントを使う形に直した。", result: "ダッシュボードから外部のフォントを読まなくなった。", found_by: "gpt", commit_sha: "dfb2c61" },
  { key: "tool-review-false-alarm", day: "2026-11-10", kind: "bug", title: "ツール本体が消えたとAIが誤って報告していた", happened: "ツールの新しい版を確かめるとき、文章を見るAIに「ツール本体のない今の文章」と「本体のある前の版」を比べさせていたため、本体がなくなったと誤って報告し、問題のない版が人の確認に回っていた。", noticed: "キーキャップ配色ためし塗りの報告を見て「不具合の原因探りたい」と調査を指示した。", decision: "Claude Codeが処理を調べて原因を見つけ、比べる材料からツール本体を外した。", result: "テストで、比べる材料にツール本体が入らないことを確かめた。本番で誤報告が止まったかはまだ確かめていない。", found_by: "human,release", commit_sha: "4dbe25f" },
  { key: "ci-font-build", day: "2026-11-10", kind: "bug", title: "ビルドがGoogleフォントの取得で失敗していた", happened: "初めて動かしたCIのビルドが、Googleフォントの取得の処理で止まった。Railwayのビルドの失敗も同じ原因の可能性が高い。", noticed: "CIを入れると決め、修正をPRに反映することを判断した。", decision: "Claude Codeがログを読んで原因を調べ、ビルドのときにフォントを取りに行かない形に直した。", result: "同じPRのCIが通るようになった。", found_by: "test", commit_sha: "922bb71" },
  { key: "count-mismatch", day: "2026-11-10", kind: "bug", title: "集客の件数が 4/3件 になっていた", happened: "投稿の上限より実際の件数が多く見える表示になっていた。", noticed: "画面を見て「集客のところ直近24時間 4/3件みたいなテキストになるんだけど分母と分子あってる？」と指摘した。", decision: "Claude Codeが、分母が古い設定のままで分子も実際の判定と数え方が違うことを調べ、上限の判定を1か所にまとめた。計画がない日の食い違いは、Claude Codeのコードレビューで見つけて直した。", result: "本番の表示が 1/10、5/10 のように、実際に投稿を止める上限と同じ基準になった。", found_by: "human,release", commit_sha: "e3c21d8" },
  { key: "real-screen-video", day: "2026-11-09", kind: "direction", title: "字幕の動画より、本物の画面を見せる", happened: "AIが台本を書いた字幕だけの動画を作れるようにしたが、普通のテキスト動画に見えた。", noticed: "見本を見て「もっとダッシュボードの動きとか見せられた動画とかの方が面白そうだけどね」と提案し、作ることを決めた。", decision: "Claude Codeが、ゲスト用の本物の画面を順に映す動画を作れるようにした。字幕の数字は記録から入れ、台本にAIは使わない。", result: "手元で動画を作って確認した。投稿したときの効果はまだ測っていない。", found_by: "human", commit_sha: "3120b11" },
  { key: "video-memory", day: "2026-11-09", kind: "bug", title: "本番のサーバーで動画を作れなかった", happened: "手元では動いた動画の変換が、本番ではエラーで止まった。", noticed: "本番のボタンを押してエラーを見つけ、調査と修正を指示した。", decision: "Claude Codeが原因をメモリ不足と推定し（ログに決め手はなし）、変換の設定を見直して、変換の前にブラウザを閉じるようにした。", result: "使用メモリのピークが約720MBから約130MBに減った（手元での測定、約81%減）。修正後は本番で動画を作成できた。", found_by: "human,release", commit_sha: "5d50a0a" },
  { key: "notify-diary", day: "2026-11-09", kind: "design", title: "通知を「やったこと」だけにし、日報とまとめを1つにした", happened: "Discordに「これから」の通知が流れ、夜の日報と1日のまとめも別の処理で別の時刻に動いていた。", noticed: "「discordのこれからって投稿いらない」「そもそも日報とまとめの処理一緒で良いのでは」と指摘した。", decision: "Claude Codeが、始めるときの通知をやめ、夜の処理を「日報を書いて、そのままDiscordに送る」1つにした。", result: "本番に反映した。日報入りのまとめが届いたかは、まだこの記録では確かめていない。", found_by: "human", commit_sha: "c01f40a" },
  { key: "new-axis", day: "2026-11-09", kind: "design", title: "AIに「別軸」の提案もさせる", happened: "提案箱に入るのは今のやり方の改善ばかりで、動画のような新しい手はAIから出ていなかった。", noticed: "「こういう提案も提案箱に入るようになると良いな」と指摘した。", decision: "Claude Codeが、定例会議で、まだ試していない手を別の基準で採点し、一番良いものを1件は提案箱に入れるようにした。", result: "データの写しで、3社すべてが別軸の案を出すことを確かめた。本番の定例会議の結果はまだ出ていない。", found_by: "human", commit_sha: "c01f40a" },
  { key: "tool-cut-53", day: "2026-11-09", kind: "bug", title: "ツール作成が途中で切れて、1回で約96円が無駄になった", happened: "案件#53のコードを書くAIが、出力の上限まで使い切って止まった。", noticed: "「あと53の案件がまた 出力が長すぎて途中で切れましたになった」と失敗を報告し、調査を指示した。", decision: "Claude Codeが、上限が6.4万トークンまで使い切られたことを調べ、上限を下げて、切れたら別の会社のAIに規模を絞って1回だけ書き直させるようにした。", result: "引き継ぎの動きはテストで確かめた。本番で同じ失敗が起きたときの動作はまだ確かめていない。", found_by: "human,release", commit_sha: "58b8fd9" },
  { key: "hold-status", day: "2026-11-09", kind: "design", title: "案件に「保留」を作った", happened: "季節もののように今は集客しても届かない案件も、撤退か継続かの判断に進んでしまう作りだった。", noticed: "「案件の保留ってステータスは必要だと思う？」と問いかけ、提案された形で作ることを決めた。", decision: "Claude Codeが、公開と記録は続けて宣伝・判断・改善だけを止める形を提案して作った。保留にできるのは人だけにした。", result: "本番に反映した。実際の案件で使った結果はまだない。", found_by: "human", commit_sha: "58b8fd9" },
  { key: "improve-cut-36", day: "2026-11-09", kind: "bug", title: "ツールの改善が失敗し、約59円が2回無駄になった", happened: "案件#36の改善で、処理が失敗して費用だけがかかった。", noticed: "失敗を見て「以下失敗の原因は？ 他の処理とぶつかったかな」と調査を指示した。", decision: "Claude Codeが、文章を直すAIにツールのプログラム全文を渡していて出力が切れていたことを調べ、シェア文だけ引き継ぐようにした。", result: "同じ処理の費用が約59円から約9円になった。", found_by: "human,release", commit_sha: "6c5a8d5" },
  { key: "mobile-overflow", day: "2026-11-06", kind: "bug", title: "スマホで画面が横にはみ出していた", happened: "ダッシュボードの一部がスマホ幅で横にはみ出し、スクロールが必要になっていた。", noticed: "「ダッシュボードのスマホ表示が横スクロールしちゃったりしてきになる」と指摘した。", decision: "Claude Codeが、幅の計算と長い文字の折り返しを直した。", result: "スマホ幅で横にはみ出さないことを確かめた。", found_by: "human,release", commit_sha: "3bb115d" },
  { key: "three-company-ideas", day: "2026-11-05", kind: "direction", title: "アイデア出しを3社の競争にした", happened: "設定した1社のAIだけがアイデアを出していて、会社どうしを比べられなかった。", noticed: "「AIにアイデアを出させるって 設定したAIだけが思考するっけ？」と問いかけ、選択肢を比べて3社方式に決めた。", decision: "Claude Codeが、Claude・GPT・Geminiが案を出し、作者を伏せて採点し合う形に変えた。", result: "本番で運用している。", found_by: "human", commit_sha: "29973d3" },
];

const g = globalThis as unknown as { __aiLabInterventionsSeeded?: boolean };

function seedOnce() {
  if (g.__aiLabInterventionsSeeded) return;
  const update = db().prepare("UPDATE interventions SET day = ?, kind = ?, title = ?, happened = ?, noticed = ?, decision = ?, result = ?, found_by = ?, commit_sha = ? WHERE seed_key = ?");
  const insert = db().prepare("INSERT INTO interventions (day, kind, title, happened, noticed, decision, result, found_by, commit_sha, seed_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  db().transaction(() => {
    for (const x of [...FIRST].reverse()) {
      const v = [x.day, x.kind, x.title, x.happened, x.noticed, x.decision, x.result, x.found_by, x.commit_sha, x.key];
      if (!update.run(...v).changes) insert.run(...v);
    }
  })();
  g.__aiLabInterventionsSeeded = true;
}

export function listInterventions(limit = 200): InterventionRow[] {
  seedOnce();
  return db().prepare("SELECT * FROM interventions WHERE hidden = 0 ORDER BY day DESC, id DESC LIMIT ?").all(limit) as InterventionRow[];
}

export function addIntervention(v: Record<string, unknown>): number {
  const text = (k: string, max: number) => String(v[k] ?? "").trim().slice(0, max);
  const title = text("title", 80), happened = text("happened", 400), noticed = text("noticed", 300), decision = text("decision", 400), result = text("result", 300), sha = text("commit", 40);
  const kind = (["bug", "design", "direction"].includes(String(v.kind)) ? v.kind : "bug") as InterventionKind;
  const found = [...new Set((Array.isArray(v.found_by) ? v.found_by : []).filter(isFoundBy))];
  if (!title || !happened || !noticed || !decision) throw new Error("題・問題・人の対応・AIの対応は、すべて書いてください");
  if (sha && !/^[0-9a-f]{7,40}$/.test(sha)) throw new Error("コミットは英数字のIDで入れてください");
  seedOnce();
  return Number(db().prepare("INSERT INTO interventions (day, kind, title, happened, noticed, decision, result, found_by, commit_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(jstDay(), kind, title, happened, noticed, decision, result || null, found.join(",") || null, sha || null).lastInsertRowid);
}

export function hideIntervention(id: number) {
  db().prepare("UPDATE interventions SET hidden = 1 WHERE id = ?").run(id);
}

// AIの事業運営に人が介入した回数（処理の記録から数える。デモの案件は入れない）
const OPERATION_KINDS: { label: string; kinds: string[] }[] = [
  { label: "AIの提案を承認・却下", kinds: ["approval"] },
  { label: "公開後に評価", kinds: ["human-review"] },
  { label: "公開を止めた", kinds: ["stop"] },
  { label: "修正やデザインを指示", kinds: ["revise-request", "auto-fix", "page", "lp-switch"] },
  { label: "案件を保留にした", kinds: ["hold"] },
  { label: "SNSに手で投稿・返信", kinds: ["sns-post", "sns-reply"] },
];

export function operationCounts(): { label: string; n: number }[] {
  const rows = db().prepare("SELECT e.kind, COUNT(*) AS n FROM events e JOIN projects p ON p.id = e.project_id WHERE e.actor = 'human' AND p.demo = 0 GROUP BY e.kind").all() as { kind: string; n: number }[];
  const count = new Map(rows.map((r) => [r.kind, r.n]));
  return OPERATION_KINDS.map((g) => ({ label: g.label, n: g.kinds.reduce((s, k) => s + (count.get(k) ?? 0), 0) }));
}

-- 종목 별칭(영문명의 한글 표기, 줄임말 등)과 관심 종목

ALTER TABLE stocks ADD COLUMN aliases TEXT NOT NULL DEFAULT '';

UPDATE stocks SET aliases = '삼전,삼성' WHERE symbol = '005930';
UPDATE stocks SET aliases = '삼전우,삼성우' WHERE symbol = '005935';
UPDATE stocks SET aliases = '하이닉스,에스케이하이닉스,하닉,SK hynix' WHERE symbol = '000660';
UPDATE stocks SET aliases = '엘지에너지솔루션,엘지엔솔,엔솔,LG엔솔' WHERE symbol = '373220';
UPDATE stocks SET aliases = '삼바,삼성바이오' WHERE symbol = '207940';
UPDATE stocks SET aliases = '현대자동차,현차' WHERE symbol = '005380';
UPDATE stocks SET aliases = '셀트' WHERE symbol = '068270';
UPDATE stocks SET aliases = '케이비금융,국민은행,KB국민' WHERE symbol = '105560';
UPDATE stocks SET aliases = '신한금융,신한은행' WHERE symbol = '055550';
UPDATE stocks SET aliases = '한화에어로,한에어' WHERE symbol = '012450';
UPDATE stocks SET aliases = '네이버,naver' WHERE symbol = '035420';
UPDATE stocks SET aliases = '카카오톡' WHERE symbol = '035720';
UPDATE stocks SET aliases = '포스코홀딩스,포스코,posco' WHERE symbol = '005490';
UPDATE stocks SET aliases = '엘지화학' WHERE symbol = '051910';
UPDATE stocks SET aliases = '삼성에스디아이,SDI' WHERE symbol = '006400';
UPDATE stocks SET aliases = '삼성물산' WHERE symbol = '028260';
UPDATE stocks SET aliases = '엘지전자' WHERE symbol = '066570';
UPDATE stocks SET aliases = '엘지' WHERE symbol = '003550';
UPDATE stocks SET aliases = '에스케이' WHERE symbol = '034730';
UPDATE stocks SET aliases = '에스케이이노베이션,SK이노' WHERE symbol = '096770';
UPDATE stocks SET aliases = '에스케이텔레콤,SKT' WHERE symbol = '017670';
UPDATE stocks SET aliases = '케이티' WHERE symbol = '030200';
UPDATE stocks SET aliases = '하나금융,하나은행' WHERE symbol = '086790';
UPDATE stocks SET aliases = '우리금융,우리은행' WHERE symbol = '316140';
UPDATE stocks SET aliases = '한전' WHERE symbol = '015760';
UPDATE stocks SET aliases = '케이티앤지,KTNG' WHERE symbol = '033780';
UPDATE stocks SET aliases = '삼성SDS,SDS,에스디에스' WHERE symbol = '018260';
UPDATE stocks SET aliases = '에이치엠엠,현대상선' WHERE symbol = '011200';
UPDATE stocks SET aliases = '배그,펍지' WHERE symbol = '259960';
UPDATE stocks SET aliases = '빅히트,HYBE' WHERE symbol = '352820';
UPDATE stocks SET aliases = '카뱅' WHERE symbol = '323410';
UPDATE stocks SET aliases = '카페' WHERE symbol = '377300';
UPDATE stocks SET aliases = '포퓨,포스코케미칼' WHERE symbol = '003670';
UPDATE stocks SET aliases = '대우조선해양,대우조선' WHERE symbol = '042660';
UPDATE stocks SET aliases = '에이치디현대중공업,현대중공업' WHERE symbol = '329180';
UPDATE stocks SET aliases = '에이치디한국조선해양,한국조선해양' WHERE symbol = '009540';
UPDATE stocks SET aliases = '에이치디현대,현대중공업지주' WHERE symbol = '267250';
UPDATE stocks SET aliases = '에이치디현대일렉트릭,현대일렉트릭' WHERE symbol = '267260';
UPDATE stocks SET aliases = '두산중공업,두산에너지' WHERE symbol = '034020';
UPDATE stocks SET aliases = 'IBK,IBK기업은행' WHERE symbol = '024110';
UPDATE stocks SET aliases = '씨제이제일제당,제일제당' WHERE symbol = '097950';
UPDATE stocks SET aliases = 'NC,엔씨,NCSOFT' WHERE symbol = '036570';
UPDATE stocks SET aliases = '롯데켐' WHERE symbol = '011170';
UPDATE stocks SET aliases = '에스케이바이오사이언스,SK바사' WHERE symbol = '302440';
UPDATE stocks SET aliases = '에스케이바이오팜' WHERE symbol = '326030';
UPDATE stocks SET aliases = 'KAI,카이' WHERE symbol = '047810';
UPDATE stocks SET aliases = '메리츠' WHERE symbol = '138040';
UPDATE stocks SET aliases = '엘지이노텍' WHERE symbol = '011070';
UPDATE stocks SET aliases = '엘지디스플레이,LGD' WHERE symbol = '034220';
UPDATE stocks SET aliases = '엘지유플러스,LGU+,유플러스' WHERE symbol = '032640';
UPDATE stocks SET aliases = '에쓰오일,에스오일,S오일,SOIL' WHERE symbol = '010950';
UPDATE stocks SET aliases = '지에스' WHERE symbol = '078930';
UPDATE stocks SET aliases = '씨제이' WHERE symbol = '001040';
UPDATE stocks SET aliases = '웅진코웨이' WHERE symbol = '021240';
UPDATE stocks SET aliases = '비지에프리테일,CU' WHERE symbol = '282330';
UPDATE stocks SET aliases = '한국타이어' WHERE symbol = '161390';
UPDATE stocks SET aliases = '밥캣' WHERE symbol = '241560';
UPDATE stocks SET aliases = '한미반도체' WHERE symbol = '042700';
UPDATE stocks SET aliases = '에스케이스퀘어' WHERE symbol = '402340';
UPDATE stocks SET aliases = '삼성이앤에이,삼성엔지니어링,삼성EA' WHERE symbol = '028050';
UPDATE stocks SET aliases = '엘에스일렉트릭,LS일렉트릭,LS산전,엘에스산전' WHERE symbol = '010120';
UPDATE stocks SET aliases = '가스공사' WHERE symbol = '036460';
UPDATE stocks SET aliases = '엔에이치투자증권,NH' WHERE symbol = '005940';
UPDATE stocks SET aliases = '지에스건설' WHERE symbol = '006360';
UPDATE stocks SET aliases = '포스코디엑스,포스코ICT' WHERE symbol = '022100';
UPDATE stocks SET aliases = '에코프로BM,에코비엠' WHERE symbol = '247540';
UPDATE stocks SET aliases = '에이치엘비' WHERE symbol = '028300';
UPDATE stocks SET aliases = '제이와이피,JYP' WHERE symbol = '035900';
UPDATE stocks SET aliases = 'SM,에스엠엔터,SM엔터테인먼트' WHERE symbol = '041510';
UPDATE stocks SET aliases = 'YG,와이지' WHERE symbol = '122870';
UPDATE stocks SET aliases = '레인보우' WHERE symbol = '277810';
UPDATE stocks SET aliases = '레고켐바이오,레고켐' WHERE symbol = '141080';
UPDATE stocks SET aliases = '아이에스씨' WHERE symbol = '095340';
UPDATE stocks SET aliases = '검은사막' WHERE symbol = '263750';

-- 관심 종목 (별표)
CREATE TABLE favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

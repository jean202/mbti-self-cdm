const { AppService } = require('../dist/modules/app/app.service');
const { HomeService } = require('../dist/modules/home/home.service');
const { PrismaService } = require('../dist/infra/prisma/prisma.service');
const {
  TypeProfileLoaderService,
} = require('../dist/modules/type-profiles/type-profile-loader.service');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ONE_ID = '11111111-1111-4111-8111-111111111115';

async function main() {
  const prismaService = new PrismaService();
  const typeProfileLoaderService = new TypeProfileLoaderService({
    get(key) {
      return process.env[key];
    },
  });
  const appService = new AppService(prismaService);
  const homeService = new HomeService(prismaService, typeProfileLoaderService);

  try {
    const bootstrap = await appService.getBootstrap(USER_ID);
    const localDate = getTodayInTimezone('Asia/Seoul');
    const home = await homeService.getHome(USER_ID, localDate);
    const todayFocus = await homeService.upsertTodayFocus(USER_ID, {
      local_date: localDate,
      title: '오늘의 초점 한 가지',
      note: 'personalized home payload 검증용 today focus',
      linked_task_id: TASK_ONE_ID,
    });

    console.log(
      JSON.stringify(
        {
          bootstrap,
          home,
          today_focus_upsert: todayFocus,
        },
        null,
        2,
      ),
    );
  } finally {
    await prismaService.$disconnect();
  }
}

function getTodayInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to derive local date for vertical slice verification.');
  }

  return `${year}-${month}-${day}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

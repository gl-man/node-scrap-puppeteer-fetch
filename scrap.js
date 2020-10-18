const mysql = require("mysql");
const puppeteer = require("puppeteer");
require("dotenv").config();

// First you need to create a connection to the database
// Be sure to replace 'user' and 'password' with the correct values
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

const promiseSQL = (sql) => {
  return new Promise((resolve, reject) => {
    // if (connection.state !== "authenticated") reject(new Error("DB Connection is not established"));
    connection.query(sql, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
};

const saveData = (keys, data) => {
  const table_name = `scrap_data_${new Date().getTime()}`;
  return promiseSQL(`SHOW TABLES LIKE "${table_name}"`)
    .then((result) => {
      if (!result || !result.length) {
        const attrs = keys.reduce((acc, cur) => {
          return `${acc}, ${cur.fieldName} VARCHAR(255)`;
        }, "id INT AUTO_INCREMENT PRIMARY KEY");

        return promiseSQL(`CREATE TABLE ${table_name} (${attrs})`);
      }
    })
    .then(() => {
      const columns = keys.reduce((acc, cur) => (acc ? `${acc}, ${cur.fieldName}` : cur.fieldName), "");
      const rows = data.reduce((acc, row) => {
        const rowData = row
          .map((value) => value)
          .reduce((str, value) => (str ? `${str}, "${value}"` : `"${value}"`), "");
        if (acc) return `${acc}, (${rowData})`;
        else return `(${rowData})`;
      }, "");
      if (!columns || !rows) return;
      return promiseSQL(`INSERT INTO ${table_name} (${columns}) VALUES ${rows}`);
    });
};

(async () => {
  const browser = await puppeteer.launch({
    headless: process.env.NODE_ENV === "production",
    slowMo: process.env.NODE_ENV === "production" ? 0 : 80,
  });

  connection.connect((err) => {
    if (err) {
      console.error("Error connecting to DB");
      console.error(error);
      return;
    }
    console.log("DB Connection established");
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 800 });

    //Login
    console.log("Login");
    await page.goto("https://develop.pub.afflu.net/login");
    await page.type('.login-form input[name="username"]', process.env.AFFLUENT_USERNAME);
    await page.type('.login-form input[name="password"]', process.env.AFFLUENT_PASSWORD);
    await page.click('.login-form button[type="submit"]');
    const authResponse = await page.waitForResponse((response) => response.url().endsWith("/authentication"));
    if (authResponse.status() === 201) {
      console.log("Login success");
    } else {
      console.warn("Login failed");
      if (authResponse.status() === 401) throw new Error("Invalid username or password");
      else throw new Error("auth response status: ", authResponse.status());
    }
    await page.screenshot({ path: "logs/screenshot_login_success.png" });
    console.log("See screenshot: " + "logs/screenshot_login_success.png");

    // Go to the target url
    console.log("Navigate to dashboard and change the date range");
    await page.goto("https://develop.pub.afflu.net/list?type=dates", {
      waitUntil: "networkidle2",
    });

    await page.waitForSelector('table[data-url="dates"]').catch(() => {
      throw new Error(`Can't find 'table[data-url="dates"]' on the page`);
    });
    const date_table_selector = await page.$eval('table[data-url="dates"]', (el) => el.id);
    if (!date_table_selector) {
      throw new Error(`Can't find id of 'table[data-url="dates"]' on the page`);
    }
    // Change the date range
    const date_select_comp_selector = "body > .daterangepicker.dropdown-menu";
    const date_start_selector = `${date_select_comp_selector} input[name="daterangepicker_start"]`;
    const date_end_selector = `${date_select_comp_selector} input[name="daterangepicker_end"]`;
    await page.waitForSelector(".page-content .page-toolbar #dashboard-report-range").catch(() => {
      throw new Error(`Can't find '.page-content .page-toolbar #dashboard-report-range' on the page`);
    });
    await page.click(".page-content .page-toolbar #dashboard-report-range");

    await page.$eval(date_start_selector, (el) => (el.value = ""));
    await page.type(date_start_selector, "04/01/2020");

    await page.$eval(date_end_selector, (el) => (el.value = ""));
    await page.type(date_end_selector, "04/30/2020");

    await page.click(`${date_select_comp_selector} button.applyBtn`);

    await page.waitForResponse((response) => response.url().endsWith("/dates") && response.status() === 200);
    // or we can simply
    // await page.goto("https://develop.pub.afflu.net/list?type=dates&startDate=2020-04-01&endDate=2020-04-30")

    //Change the data table length
    console.log("Change the data table length");
    const date_table_length_id = `${date_table_selector}_length`;
    const select_comp_selector = `.page-content-body #${date_table_length_id} .dropdown.bootstrap-select`;
    await page.waitForSelector(`${select_comp_selector} button.dropdown-toggle`).catch(() => {
      throw new Error(`Can't find '${select_comp_selector} button.dropdown-toggle' on the page`);
    });
    await page.click(`${select_comp_selector} button.dropdown-toggle`);
    await page.waitForSelector(`${select_comp_selector}.open`);
    await page.click(`${select_comp_selector} .dropdown-menu.inner > li:last-child`);
    await page.waitForResponse((response) => response.url().endsWith("/dates") && response.status() === 200);

    console.log("Ready for scraping");
    await page.screenshot({ path: "logs/screenshot_dates.png" });
    console.log("See screenshot: " + "logs/screenshot_dates.png");

    // Scrap the data
    const [keys] = await page.$$eval(`#${date_table_selector} > thead > tr`, (trs) =>
      trs.map((tr) => {
        const ths = [...tr.getElementsByTagName("th")];
        return ths.map((th) => ({
          title: th.textContent,
          fieldName: th.getAttribute("data-data"),
          originalTitle: th.getAttribute("data-original-title"),
          description: th.getAttribute("data-content"),
          format: th.getAttribute("data-format"),
        }));
      })
    );
    if (!keys) {
      throw new Error(`Can't find '#${date_table_selector} > thead > tr' on the page`);
    }
    const data = await page.$$eval(`#${date_table_selector} > tbody > tr`, (trs) =>
      trs.map((tr) => {
        const tds = [...tr.getElementsByTagName("td")];
        return tds.map((td) => td.textContent);
      })
    );

    await saveData(keys, data);

    connection.end();
  } catch (err) {
    console.error(err);
  }

  browser.close();
})();

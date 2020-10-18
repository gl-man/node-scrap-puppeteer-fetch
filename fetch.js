const mysql = require("mysql");
const axios = require("axios");
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
  const table_name = `fetch_data_${new Date().getTime()}`;
  return promiseSQL(`SHOW TABLES LIKE "${table_name}"`)
    .then((result) => {
      if (!result || !result.length) {
        const attrs = keys.reduce((acc, field) => {
          if(field === 'id') return acc;
          return `${acc}, ${field} VARCHAR(255)`;
        }, "id INT PRIMARY KEY");

        return promiseSQL(`CREATE TABLE ${table_name} (${attrs})`);
      }
    })
    .then(() => {
      const columns = keys.reduce((acc, field) => (acc ? `${acc}, ${field}` : field), "");
      const rows = data.reduce((acc, row) => {
        const rowData = keys
          .map((field) => row[field])
          .reduce((str, value) => (str ? `${str}, "${value}"` : `"${value}"`), "");
        if (acc) return `${acc}, (${rowData})`;
        else return `(${rowData})`;
      }, "");
      if (!columns || !rows) return;
      return promiseSQL(`INSERT INTO ${table_name} (${columns}) VALUES ${rows}`);
    });
};

(async () => {
  const api = axios.create({
    baseURL: "https://reqres.in/",
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
    const { keys, data } = await api
      .get("/api/users")
      .then(async (res) => {
        const { total_pages, data } = res.data;

        const pageNumbers = [];
        // The first page has been loaded.
        for (let pageIndex = 2; pageIndex <= total_pages; pageIndex++) {
          pageNumbers.push(pageIndex);
        }
        const promises = pageNumbers.map((page_number) =>
          api.get(`/api/users?page=${page_number}`).then((res) => res.data)
        );
        const resDatas = await Promise.all(promises);

        return [data, ...resDatas.map((res) => res.data)];
      })
      .then((datas) =>
        datas.reduce(
          (acc, cur) => ({
            keys: acc.keys.length ? acc.keys : Object.keys(cur[0] || {}),
            data: acc.data.concat(cur),
          }),
          { keys: [], data: [] }
        )
      );

    await saveData(keys, data);

    connection.end();
  } catch (err) {
    console.error(err);
  }
})();
